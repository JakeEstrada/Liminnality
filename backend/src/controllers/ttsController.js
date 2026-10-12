const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const ELEVEN_SPEECH_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const MAX_TTS_CHARS = 800;

const ELEVEN_VOICES = {
  sarah: { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah — natural American woman' },
  adam: { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam — natural American man' },
  jessa: { id: 'yj30vwTGJxSHezdAGsv9', label: 'Jessa — clear woman' },
  victor: { id: 'cPoqAvGWCPfCfyPMwe4z', label: 'Victor — clear man' },
  carla: { id: 'ZP7ctTmcovXNUmOj695o', label: 'Carla — calm, a little mysterious' },
  natasha: { id: 'j05EIz3iI3JmBTWC3CsA', label: 'Natasha — warm woman' },
  kaori: { id: 'mDxkcO3nsRCNeB4si9qg', label: 'Kaori — Japanese woman' },
  sakura: { id: 'gHBfNp2PWSyFgpPlzCOd', label: 'Sakura — gentle Japanese woman' },
  cassius: { id: 'ktrGUw7rURIQyMrQZqCu', label: 'Cassius — man' },
};

const DEFAULT_ELEVEN_VOICE = 'sarah';

const OPENAI_VOICES = {
  marin: { label: 'Marin — clearest woman' },
  coral: { label: 'Coral — warm woman' },
  nova: { label: 'Nova — bright woman' },
  shimmer: { label: 'Shimmer — soft woman' },
  sage: { label: 'Sage — calm woman' },
  verse: { label: 'Verse — conversational woman' },
  ballad: { label: 'Ballad — expressive woman' },
  fable: { label: 'Fable — British woman' },
  alloy: { label: 'Alloy — neutral' },
  cedar: { label: 'Cedar — clear man' },
  echo: { label: 'Echo — man' },
  ash: { label: 'Ash — man' },
  onyx: { label: 'Onyx — deep man' },
};

const OPENAI_FALLBACK = {
  sarah: 'marin',
  adam: 'echo',
  jessa: 'marin',
  victor: 'echo',
  carla: 'marin',
  natasha: 'coral',
  kaori: 'nova',
  sakura: 'shimmer',
  cassius: 'cedar',
};

const LIMINALITY_INSTRUCTIONS =
  'Speak as Liminality, a clear American woman. Plain, calm, and brief. No flirting, no attitude, no customer-service filler. Sound like a coworker reading a short note.';

const CANDID_INSTRUCTIONS =
  'Speak plainly and briefly. No jokes, no attitude, no filler. Same calm coworker tone.';

function openaiKey() {
  return String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim();
}

function cleanSecret(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function elevenKey() {
  return cleanSecret(
    process.env.ELEVENLABS_API_KEY ||
      process.env.ELEVEN_API_KEY ||
      process.env.XI_API_KEY ||
      ''
  );
}

function elevenKeyProblem() {
  const key = elevenKey();
  if (!key) {
    return 'ElevenLabs API key is missing on the API server. Set ELEVENLABS_API_KEY on Render (the backend), not Vercel, then restart that service.';
  }
  return '';
}

function parseVoice(raw) {
  const requested = String(raw || '').trim();
  if (!requested) {
    if (elevenKey()) {
      return {
        provider: 'eleven',
        key: DEFAULT_ELEVEN_VOICE,
        elevenId: ELEVEN_VOICES[DEFAULT_ELEVEN_VOICE].id,
      };
    }
    return { provider: 'openai', key: 'marin' };
  }
  const [prefix, rest] = requested.includes(':') ? requested.split(':', 2) : ['', requested];
  const name = String(rest || prefix || requested).trim().toLowerCase();
  if (prefix === 'eleven' || ELEVEN_VOICES[name]) {
    const voice = ELEVEN_VOICES[name] || ELEVEN_VOICES[DEFAULT_ELEVEN_VOICE];
    const key = ELEVEN_VOICES[name] ? name : DEFAULT_ELEVEN_VOICE;
    return { provider: 'eleven', key, elevenId: voice.id };
  }
  if (prefix === 'openai' || OPENAI_VOICES[name]) {
    return { provider: 'openai', key: OPENAI_VOICES[name] ? name : 'marin' };
  }
  if (elevenKey()) {
    return {
      provider: 'eleven',
      key: DEFAULT_ELEVEN_VOICE,
      elevenId: ELEVEN_VOICES[DEFAULT_ELEVEN_VOICE].id,
    };
  }
  return { provider: 'openai', key: 'marin' };
}

function catalog(req, res) {
  const voices = Object.entries(ELEVEN_VOICES).map(([id, voice]) => ({
    uri: `eleven:${id}`,
    id,
    label: voice.label,
    group: 'Lifelike',
  }));
  return res.json({
    provider: 'elevenlabs',
    configured: Boolean(elevenKey()) && !elevenKeyProblem(),
    defaultVoice: `eleven:${DEFAULT_ELEVEN_VOICE}`,
    voices,
  });
}

function prepareSpeechRequest(req) {
  const text = String(req.body?.text || '').trim().slice(0, MAX_TTS_CHARS);
  if (!text) return { error: 'Text is required.', status: 400 };
  const keyProblem = elevenKeyProblem();
  if (keyProblem) return { error: keyProblem, status: 503 };
  const parsed = parseVoice(req.body?.voice);
  const tone = String(req.body?.tone || '').toLowerCase() === 'candid' ? 'candid' : 'polite';
  return {
    text,
    tone,
    elevenId: parsed.elevenId || ELEVEN_VOICES[DEFAULT_ELEVEN_VOICE].id,
    key: elevenKey(),
  };
}

async function synthesizeSpeech(req, res) {
  const ready = prepareSpeechRequest(req);
  if (ready.error) return res.status(ready.status).json({ error: ready.error });

  try {
    const audio = await requestElevenSpeech(ready.key, ready.elevenId, ready.text, ready.tone, 'mp3');
    if (audio.ok) return sendAudio(res, audio.buffer);
    return res.status(502).json({ error: audio.error });
  } catch {
    return res.status(502).json({ error: 'Could not generate ElevenLabs speech.' });
  }
}

async function streamSpeech(req, res) {
  const ready = prepareSpeechRequest(req);
  if (ready.error) return res.status(ready.status || 400).json({ error: ready.error });

  try {
    const audio = await requestElevenSpeech(ready.key, ready.elevenId, ready.text, ready.tone, 'pcm');
    if (!audio.ok || !audio.body) {
      return res.status(502).json({ error: audio.error || 'Could not stream ElevenLabs speech.' });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Paarth-Audio', 'pcm_s16le_24000');
    const { Readable } = require('stream');
    const nodeStream = typeof Readable.fromWeb === 'function' ? Readable.fromWeb(audio.body) : null;
    if (!nodeStream) {
      const buffer = Buffer.from(await new Response(audio.body).arrayBuffer());
      return res.send(buffer);
    }
    req.on('close', () => {
      try {
        nodeStream.destroy();
      } catch {
        /* ignore */
      }
    });
    nodeStream.on('error', () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) {
      return res.status(502).json({ error: 'Could not stream ElevenLabs speech.' });
    }
    res.end();
  }
}

function sendAudio(res, audio) {
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(audio);
}

function friendlyElevenError(raw) {
  const message = String(raw || '').trim();
  if (/api key id used as api key|invalid_api_key|api keys start with/i.test(message)) {
    return 'ElevenLabs rejected the key. Paste the secret that starts with sk_ into ELEVENLABS_API_KEY, not the key ID, then restart the backend.';
  }
  if (/missing_permissions|forbidden|voices_read|tts/i.test(message)) {
    return 'ElevenLabs key is missing permission to use text to speech or this voice.';
  }
  return message || 'ElevenLabs could not generate speech.';
}

const FAST_ELEVEN_MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_multilingual_v2'];

function elevenModelChain() {
  const preferred = String(process.env.ELEVENLABS_TTS_MODEL || FAST_ELEVEN_MODELS[0]).trim();
  return [preferred, ...FAST_ELEVEN_MODELS.filter((model) => model !== preferred)];
}

function voiceSettingsFor(model, tone) {
  const candid = tone === 'candid';
  const settings = {
    stability: candid ? 0.3 : 0.42,
    similarity_boost: 0.85,
    use_speaker_boost: true,
  };
  if (model.includes('multilingual_v2') && !model.startsWith('eleven_v3')) {
    settings.style = candid ? 0.58 : 0.28;
  }
  return settings;
}

function canFallbackElevenModel(status, error) {
  if (status === 400 || status === 404 || status === 422) return true;
  return /model/i.test(String(error || ''));
}

function parseElevenError(raw, status) {
  let detail = `ElevenLabs HTTP ${status}`;
  try {
    const data = JSON.parse(raw);
    const nested = data?.detail;
    if (typeof nested === 'string') detail = nested;
    else if (nested?.message) detail = String(nested.message);
    else if (data?.message) detail = String(data.message);
  } catch {
    if (raw) detail = String(raw).slice(0, 280);
  }
  return friendlyElevenError(detail);
}

async function requestElevenSpeech(key, voiceId, text, tone = 'polite', format = 'mp3') {
  const models = elevenModelChain();
  let lastError = 'ElevenLabs could not generate speech.';
  const stream = format === 'pcm';
  const path = stream ? `${ELEVEN_SPEECH_URL}/${voiceId}/stream` : `${ELEVEN_SPEECH_URL}/${voiceId}`;
  const query = stream
    ? 'output_format=pcm_24000&optimize_streaming_latency=4'
    : 'output_format=mp3_44100_64&optimize_streaming_latency=4';

  for (const model of models) {
    const response = await fetch(`${path}?${query}`, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        Accept: stream ? 'application/octet-stream' : 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: voiceSettingsFor(model, tone),
      }),
    });
    if (response.ok) {
      if (stream) return { ok: true, body: response.body };
      return { ok: true, buffer: Buffer.from(await response.arrayBuffer()) };
    }
    lastError = parseElevenError(await response.text().catch(() => ''), response.status);
    if (!canFallbackElevenModel(response.status, lastError)) {
      return { ok: false, error: lastError };
    }
  }

  return { ok: false, error: lastError };
}

async function requestOpenAiSpeech(key, voice, text, tone = 'polite') {
  const model = String(process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts').trim();
  const hdFallbackVoices = new Set(['marin', 'cedar', 'verse', 'ballad']);
  let response = await fetch(OPENAI_SPEECH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      instructions: tone === 'candid' ? CANDID_INSTRUCTIONS : LIMINALITY_INSTRUCTIONS,
      response_format: 'mp3',
    }),
  });
  if (!response.ok) {
    response = await fetch(OPENAI_SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        voice: hdFallbackVoices.has(voice) ? 'nova' : voice,
        input: text,
        response_format: 'mp3',
      }),
    });
  }
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { synthesizeSpeech, streamSpeech, catalog };
