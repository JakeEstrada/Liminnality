import { useState, type MouseEvent } from 'react';
import {
  Box,
  Button,
  FormControlLabel,
  Menu,
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
  const speed = Number(speechSpeed) || LIMINALITY_SPEED_DEFAULT;
  const live =
    runtime.phase === 'listening' ||
    runtime.phase === 'speaking' ||
    runtime.phase === 'processing' ||
    runtime.phase === 'executing';

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setAnchor(event.currentTarget);
  };

  return (
    <>
      <Button
        type="button"
        size="small"
        variant={live || enabled ? 'outlined' : 'text'}
        color={live ? 'primary' : 'inherit'}
        onClick={openMenu}
        onMouseDown={(event) => event.stopPropagation()}
        sx={{
          textTransform: 'none',
          minWidth: 0,
          px: 1,
          py: 0.25,
          fontSize: 12,
          fontWeight: 600,
          opacity: enabled ? 1 : 0.72,
        }}
      >
        Liminality
      </Button>
      <Menu
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        disableScrollLock
        slotProps={{
          paper: {
            sx: { width: 300, p: 1.5, mt: 0.5 },
            onClick: (event) => event.stopPropagation(),
          },
        }}
        MenuListProps={{ sx: { p: 0 }, onKeyDown: (event) => event.stopPropagation() }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          Liminality
        </Typography>
        <FormControlLabel
          sx={{ mx: 0, mb: 1.25, width: '100%', justifyContent: 'space-between' }}
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
        <Typography variant="caption" color="text.secondary">
          Voice
        </Typography>
        <Box
          sx={{
            mt: 0.75,
            mb: 1.5,
            maxHeight: 220,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
          }}
        >
          {ELEVEN_VOICES.map((voice) => {
            const selected = voice.uri === selectedUri;
            return (
              <Button
                key={voice.uri}
                type="button"
                size="small"
                variant={selected ? 'contained' : 'text'}
                onClick={() => {
                  unlockNeuralAudio();
                  setVoiceUri(voice.uri);
                }}
                sx={{
                  justifyContent: 'flex-start',
                  textTransform: 'none',
                  fontWeight: selected ? 700 : 500,
                  px: 1,
                }}
              >
                {voice.name}
              </Button>
            );
          })}
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">
            Speed
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {speed === LIMINALITY_SPEED_DEFAULT ? 'Normal' : speed < 1 ? 'Slower' : 'Faster'}
          </Typography>
        </Box>
        <Slider
          size="small"
          min={LIMINALITY_SPEED_MIN}
          max={LIMINALITY_SPEED_MAX}
          step={0.05}
          value={speed}
          onChange={(_event, value) => setSpeechSpeed(Number(value))}
          marks={[
            { value: LIMINALITY_SPEED_MIN, label: 'Slow' },
            { value: LIMINALITY_SPEED_MAX, label: 'Fast' },
          ]}
        />
      </Menu>
    </>
  );
}
