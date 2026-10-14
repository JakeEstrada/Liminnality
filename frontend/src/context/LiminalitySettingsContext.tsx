import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  isSpeechRecognitionSupported,
  listSelectableVoices,
  loadVoices,
  usesServerSpeechCapture,
  voiceChoiceLabel,
  warmUpSpeechVoices,
} from '../voice/browserSpeech';
import {
  readLiminalityEnabled,
  readLiminalityVoiceUri,
  writeLiminalityEnabled,
  writeLiminalityVoiceUri,
} from '../voice/liminalitySettings';
import { primeChromiumMicrophone } from '../voice/chromiumSpeech';
import { unlockNeuralAudio } from '../voice/neuralSpeech';
import { neuralVoiceIdFromUri } from '../voice/neuralVoices';
import type { LiminalityPhase } from '../hooks/useLiminalityVoice';

export type LiminalityRuntimeStatus = {
  phase: LiminalityPhase;
  statusLabel: string;
  heard: string;
  remainingMs: number;
};

type LiminalitySettingsContextValue = {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  voiceUri: string;
  setVoiceUri: (uri: string) => void;
  voices: SpeechSynthesisVoice[];
  supported: boolean;
  runtime: LiminalityRuntimeStatus;
  setRuntime: (next: LiminalityRuntimeStatus) => void;
};

const defaultRuntime: LiminalityRuntimeStatus = {
  phase: 'off',
  statusLabel: 'Off',
  heard: '',
  remainingMs: 0,
};

const LiminalitySettingsContext = createContext<LiminalitySettingsContextValue | undefined>(
  undefined
);

export function LiminalitySettingsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(readLiminalityEnabled);
  const [voiceUri, setVoiceUriState] = useState(() => neuralVoiceIdFromUri(readLiminalityVoiceUri()));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [runtime, setRuntime] = useState<LiminalityRuntimeStatus>(defaultRuntime);
  const supported = isSpeechRecognitionSupported();

  useEffect(() => {
    writeLiminalityVoiceUri(voiceUri);
  }, [voiceUri]);

  useEffect(() => {
    warmUpSpeechVoices();
    void loadVoices().then((loaded) => setVoices(listSelectableVoices(loaded)));
    const refresh = () => setVoices(listSelectableVoices(window.speechSynthesis?.getVoices() || []));
    window.speechSynthesis?.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', refresh);
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    if (next) {
      unlockNeuralAudio();
      if (usesServerSpeechCapture()) void primeChromiumMicrophone().catch(() => {});
    }
    writeLiminalityEnabled(next);
    setEnabledState(next);
  }, []);

  const setVoiceUri = useCallback((uri: string) => {
    const next = neuralVoiceIdFromUri(uri);
    writeLiminalityVoiceUri(next);
    setVoiceUriState(next);
  }, []);

  const value = useMemo(
    () => ({
      enabled,
      setEnabled,
      voiceUri,
      setVoiceUri,
      voices,
      supported,
      runtime,
      setRuntime,
    }),
    [enabled, setEnabled, voiceUri, setVoiceUri, voices, supported, runtime]
  );

  return (
    <LiminalitySettingsContext.Provider value={value}>{children}</LiminalitySettingsContext.Provider>
  );
}

export function useLiminalitySettings() {
  const context = useContext(LiminalitySettingsContext);
  if (!context) {
    throw new Error('useLiminalitySettings must be used within a LiminalitySettingsProvider');
  }
  return context;
}

export { voiceChoiceLabel };
