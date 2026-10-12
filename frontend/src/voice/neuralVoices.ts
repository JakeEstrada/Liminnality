export const ELEVEN_VOICE_PREFIX = 'eleven:';

export type NeuralVoice = {
  id: string;
  name: string;
  description: string;
  uri: string;
};

export const ELEVEN_VOICES: NeuralVoice[] = [
  { id: 'sarah', name: 'Sarah', description: 'natural American woman', uri: 'eleven:sarah' },
  { id: 'adam', name: 'Adam', description: 'natural American man', uri: 'eleven:adam' },
  { id: 'jessa', name: 'Jessa', description: 'clear woman', uri: 'eleven:jessa' },
  { id: 'victor', name: 'Victor', description: 'clear man', uri: 'eleven:victor' },
  { id: 'carla', name: 'Carla', description: 'calm, a little mysterious', uri: 'eleven:carla' },
  { id: 'natasha', name: 'Natasha', description: 'warm woman', uri: 'eleven:natasha' },
  { id: 'kaori', name: 'Kaori', description: 'Japanese woman', uri: 'eleven:kaori' },
  { id: 'sakura', name: 'Sakura', description: 'gentle Japanese woman', uri: 'eleven:sakura' },
  { id: 'cassius', name: 'Cassius', description: 'man', uri: 'eleven:cassius' },
];

export const DEFAULT_NEURAL_VOICE_URI = 'eleven:sarah';

const ELEVEN_URI_SET = new Set(ELEVEN_VOICES.map((voice) => voice.uri));

export function neuralVoiceUri(id: string) {
  if (id.startsWith(ELEVEN_VOICE_PREFIX)) return id;
  return `${ELEVEN_VOICE_PREFIX}${id}`;
}

export function isElevenVoiceUri(uri: string) {
  return ELEVEN_URI_SET.has(uri);
}

export function isNeuralVoiceUri(uri: string) {
  if (!uri) return true;
  return isElevenVoiceUri(uri);
}

export function neuralVoiceIdFromUri(uri: string) {
  if (isElevenVoiceUri(uri)) return uri;
  return DEFAULT_NEURAL_VOICE_URI;
}
