import { Box, Button, CircularProgress, LinearProgress, Typography } from '@mui/material';
import { COMMAND_TIMEOUT_MS } from '../../voice/liminalityCommands';
import type { LiminalityPhase } from '../../hooks/useLiminalityVoice';
import LiveMicWaveform from './LiveMicWaveform';

export default function LiminalityHud({
  enabled,
  phase,
  statusLabel,
  heard,
  remainingMs,
  onCancel,
}: {
  enabled: boolean;
  phase: LiminalityPhase;
  statusLabel: string;
  heard: string;
  remainingMs: number;
  onCancel?: () => void;
}) {
  if (!enabled || phase === 'off') return null;

  const listening = phase === 'listening' || phase === 'waiting';
  const commandWindow = phase === 'listening';
  const working = phase === 'processing' || phase === 'executing';
  const hearing = statusLabel.startsWith('Hearing you') || statusLabel === 'Listening';
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const progress = commandWindow
    ? Math.max(0, Math.min(100, (remainingMs / COMMAND_TIMEOUT_MS) * 100))
    : 0;
  const low = commandWindow && remainingMs > 0 && remainingMs <= 5000;
  const barColor = remainingMs <= 3000 ? 'error' : low ? 'warning' : 'primary';
  const title = working
    ? 'Working on it'
    : phase === 'speaking'
      ? 'Speaking'
      : commandWindow
        ? `Listening · ${seconds}s`
        : 'Listening';
  const detail = working
    ? heard || 'Calculating that command'
    : hearing && commandWindow
      ? 'Keep talking. This sends when you pause.'
      : commandWindow
        ? low
          ? 'Time is running out — say the command now'
          : 'Say a command. You do not need her name again.'
        : phase === 'speaking'
          ? heard || statusLabel
          : 'Say Liminality when you need her.';

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1400,
        pointerEvents: 'none',
        px: { xs: 1.5, sm: 3 },
        pb: { xs: 1.5, sm: 2 },
      }}
    >
      <Box
        sx={{
          mx: 'auto',
          maxWidth: 720,
          px: 2.5,
          py: 1.5,
          borderRadius: 3,
          bgcolor: 'background.paper',
          boxShadow: 8,
          border: 1,
          borderColor: working || listening ? 'primary.main' : 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 36 }}>
          {working ? <CircularProgress size={22} thickness={5} /> : null}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {detail}
            </Typography>
          </Box>
          {commandWindow ? (
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800,
                minWidth: 48,
                textAlign: 'right',
                color: remainingMs <= 3000 ? 'error.main' : low ? 'warning.main' : 'primary.main',
              }}
            >
              {seconds}
            </Typography>
          ) : null}
          {onCancel && phase !== 'waiting' ? (
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              onClick={onCancel}
              sx={{ pointerEvents: 'auto', textTransform: 'none', flexShrink: 0 }}
            >
              Cancel
            </Button>
          ) : null}
        </Box>
        <LiveMicWaveform />
        {commandWindow ? (
          <LinearProgress
            variant="determinate"
            value={progress}
            color={barColor}
            sx={{ mt: 1, height: 6, borderRadius: 99 }}
          />
        ) : working ? (
          <LinearProgress sx={{ mt: 1, height: 6, borderRadius: 99 }} />
        ) : null}
      </Box>
    </Box>
  );
}
