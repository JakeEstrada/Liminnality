import { useState } from 'react';
import {
  Box,
  Chip,
  FormControl,
  FormControlLabel,
  MenuItem,
  Popover,
  Select,
  Slider,
  Switch,
  Typography,
} from '@mui/material';
import { useLiminalitySettings } from '../../context/LiminalitySettingsContext';
import { unlockNeuralAudio } from '../../voice/neuralSpeech';
import {
  LIMINALITY_SPEED_DEFAULT,
  LIMINALITY_SPEED_MAX,
  LIMINALITY_SPEED_MIN,
} from '../../voice/liminalitySettings';
import { ELEVEN_VOICES, neuralVoiceIdFromUri } from '../../voice/neuralVoices';

export default function LiminalityMenu() {
  const { enabled, setEnabled, voiceUri, setVoiceUri, speechSpeed, setSpeechSpeed, supported, runtime } =
    useLiminalitySettings();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const selectedUri = neuralVoiceIdFromUri(voiceUri);
  const live =
    runtime.phase === 'listening' ||
    runtime.phase === 'speaking' ||
    runtime.phase === 'processing' ||
    runtime.phase === 'executing';

  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        color={live ? 'primary' : enabled ? 'default' : 'default'}
        label="Liminality"
        onClick={(event) => setAnchor(event.currentTarget)}
        title={runtime.heard || runtime.statusLabel || 'Liminality settings'}
        sx={{
          height: 24,
          fontSize: 11,
          opacity: enabled ? 1 : 0.7,
          '& .MuiChip-label': { px: 1 },
        }}
      />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { p: 2, width: 280, mt: 1 } } }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.25 }}>
          Liminality
        </Typography>
        <FormControlLabel
          sx={{ mx: 0, mb: 1.5, width: '100%', justifyContent: 'space-between' }}
          labelPlacement="start"
          control={
            <Switch
              size="small"
              checked={enabled}
              disabled={!supported}
              onChange={(event) => setEnabled(event.target.checked)}
            />
          }
          label={<Typography variant="body2">{enabled ? 'On' : 'Off'}</Typography>}
        />
        {!supported ? (
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
            Use Chrome or Edge on desktop.
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          Voice
        </Typography>
        <FormControl fullWidth size="small" sx={{ mt: 0.5, mb: 2 }}>
          <Select
            value={selectedUri}
            onChange={(event) => {
              unlockNeuralAudio();
              setVoiceUri(String(event.target.value));
            }}
          >
            {ELEVEN_VOICES.map((voice) => (
              <MenuItem key={voice.uri} value={voice.uri}>
                {voice.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">
            Speed
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {speechSpeed === LIMINALITY_SPEED_DEFAULT
              ? 'Normal'
              : speechSpeed < 1
                ? 'Slower'
                : 'Faster'}
          </Typography>
        </Box>
        <Slider
          size="small"
          min={LIMINALITY_SPEED_MIN}
          max={LIMINALITY_SPEED_MAX}
          step={0.05}
          value={speechSpeed}
          onChange={(_event, value) => setSpeechSpeed(Number(value))}
          marks={[
            { value: LIMINALITY_SPEED_MIN, label: 'Slow' },
            { value: LIMINALITY_SPEED_DEFAULT, label: '' },
            { value: LIMINALITY_SPEED_MAX, label: 'Fast' },
          ]}
          sx={{ mt: 0.5, mb: 0 }}
        />
      </Popover>
    </>
  );
}
