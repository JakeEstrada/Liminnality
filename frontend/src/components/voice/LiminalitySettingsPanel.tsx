import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Switch,
  Typography,
} from '@mui/material';
import { RecordVoiceOver as RecordVoiceOverIcon } from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { useLiminalitySettings } from '../../context/LiminalitySettingsContext';
import { speakText, usesServerSpeechCapture } from '../../voice/browserSpeech';
import { unlockNeuralAudio } from '../../voice/neuralSpeech';
import { DEFAULT_NEURAL_VOICE_URI, ELEVEN_VOICES, neuralVoiceIdFromUri } from '../../voice/neuralVoices';

const SAMPLE_LINES = [
  "What's cookin, good lookin?",
  'Ugh. What now?',
  "Hey you. What's up?",
  "I'm here. Spill it.",
  'You rang?',
];

export default function LiminalitySettingsPanel() {
  const theme = useTheme();
  const { enabled, setEnabled, voiceUri, setVoiceUri, supported } = useLiminalitySettings();
  const selectedUri = neuralVoiceIdFromUri(voiceUri || DEFAULT_NEURAL_VOICE_URI);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [sampleIndex, setSampleIndex] = useState(0);
  const outline =
    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';

  const voices = useMemo(() => ELEVEN_VOICES, []);

  const preview = (uri: string) => {
    unlockNeuralAudio();
    setVoiceUri(uri);
    const line = SAMPLE_LINES[sampleIndex % SAMPLE_LINES.length];
    setSampleIndex((index) => index + 1);
    setPreviewing(uri);
    setPreviewError('');
    void speakText(line)
      .catch((error) => {
        setPreviewError(error instanceof Error ? error.message : 'ElevenLabs speech failed.');
      })
      .finally(() => {
        setPreviewing((current) => (current === uri ? null : current));
      });
  };

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: '16px',
        p: 4,
        mb: 3,
        background: theme.palette.background.paper,
        boxShadow:
          theme.palette.mode === 'dark'
            ? '0 2px 12px rgba(0, 0, 0, 0.35)'
            : '0 2px 12px rgba(0, 0, 0, 0.06)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <RecordVoiceOverIcon sx={{ fontSize: 28, color: 'primary.main' }} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Liminality
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Voice on desktop. Call “Liminnality” or “Motherfucker” — listen cue, then 15 seconds of
        commands. The same cue plays when that window ends. “Send Hammer to Jake” texts that customer
        card to someone on the employee rolodex. Nothing is recorded while this is off.
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={!supported}
          />
        }
        label={enabled ? 'Enabled' : 'Disabled'}
      />
      {!supported ? (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
          Use Chrome or Edge on desktop to enable voice.
        </Typography>
      ) : usesServerSpeechCapture() ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Chromium sends the microphone to the server. Chrome and Edge still listen in the browser.
        </Typography>
      ) : null}

      <Typography variant="subtitle2" sx={{ mt: 3, mb: 1, fontWeight: 600 }}>
        Voice
      </Typography>
      <RadioGroup
        name="liminality-voice"
        value={selectedUri}
        onChange={(event) => {
          unlockNeuralAudio();
          setVoiceUri(event.target.value);
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {voices.map((voice) => {
          const selected = voice.uri === selectedUri;
          return (
            <Box
              key={voice.uri}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 1,
                borderRadius: '12px',
                border: '1px solid',
                borderColor: selected ? 'primary.main' : outline,
                backgroundColor: selected
                  ? theme.palette.mode === 'dark'
                    ? 'rgba(25, 118, 210, 0.16)'
                    : 'rgba(25, 118, 210, 0.06)'
                  : 'transparent',
              }}
            >
              <Box
                component="label"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  minWidth: 0,
                  flex: 1,
                  cursor: 'pointer',
                }}
              >
                <Radio value={voice.uri} size="small" sx={{ p: 0.5 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {voice.name}
                    {voice.uri === DEFAULT_NEURAL_VOICE_URI ? ' (recommended)' : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {voice.description}
                  </Typography>
                </Box>
              </Box>
              <Button
                variant="outlined"
                size="small"
                disabled={previewing === voice.uri}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  preview(voice.uri);
                }}
                sx={{ textTransform: 'none', flexShrink: 0 }}
              >
                {previewing === voice.uri ? 'Playing…' : 'Hear'}
              </Button>
            </Box>
          );
        })}
      </RadioGroup>
      {previewError ? (
        <Typography variant="body2" color="error" sx={{ display: 'block', mt: 1.5 }}>
          {previewError}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          ElevenLabs voices. Pick one, then tap Hear to sample it.
        </Typography>
      )}
    </Paper>
  );
}
