import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiminalitySettings } from '../../context/LiminalitySettingsContext';
import { useLiminalityVoice } from '../../hooks/useLiminalityVoice';
import LiminalityHud from './LiminalityHud';

export default function LiminalityRuntime() {
  const navigate = useNavigate();
  const { enabled, setRuntime } = useLiminalitySettings();
  const voice = useLiminalityVoice({
    enabled,
    onNavigate: (path) => navigate(path),
  });

  useEffect(() => {
    setRuntime({
      phase: voice.phase,
      statusLabel: voice.statusLabel,
      heard: voice.heard,
      remainingMs: voice.remainingMs,
    });
  }, [setRuntime, voice.heard, voice.phase, voice.remainingMs, voice.statusLabel]);

  return (
    <LiminalityHud
      enabled={enabled}
      phase={voice.phase}
      statusLabel={voice.statusLabel}
      heard={voice.heard}
      remainingMs={voice.remainingMs}
    />
  );
}
