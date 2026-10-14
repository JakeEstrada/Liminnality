import { Box, CircularProgress, LinearProgress, Typography } from '@mui/material';
import { COMMAND_TIMEOUT_MS } from '../../voice/liminalityCommands';
import type { LiminalityPhase } from '../../hooks/useLiminalityVoice';

export default function LiminalityHud({
  enabled,
  phase,
  statusLabel,
  heard,
  remainingMs,
}: {
  enabled: boolean;
  phase: LiminalityPhase;
  statusLabel: string;
  heard: string;
  remainingMs: number;
}) {
  if (!enabled || phase === 'off') return null;

  const listening = phase === 'listening';
  const working = phase === 'processing' || phase === 'executing';
  const hearing = statusLabel.startsWith('Hearing you');
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const progress = listening
    ? Math.max(0, Math.min(100, (remainingMs / COMMAND_TIMEOUT_MS) * 100))
    : 0;
  const low = listening && remainingMs > 0 && remainingMs <= 5000;
  const barColor = remainingMs <= 3000 ? 'error' : low ? 'warning' : 'primary';
  const title = working
    ? 'Working on it'
    : hearing
      ? 'Hearing you'
      : listening
        ? `Listening · ${seconds}s`
        : statusLabel;
  const detail = working
    ? heard || 'Calculating that command'
    : hearing
      ? 'Keep talking. This sends when you pause.'
      : listening
        ? low
          ? 'Time is running out — say the command now'
          : 'Say a command. You do not need her name again.'
        : heard && phase === 'speaking'
          ? heard
          : statusLabel;

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
          {working ? (
            <CircularProgress size={22} thickness={5} />
          ) : (
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor:
                  phase === 'speaking'
                    ? 'secondary.main'
                    : listening
                      ? 'primary.main'
                      : 'success.main',
                animation: listening || phase === 'waiting' ? 'liminalityPulse 1.2s ease-in-out infinite' : 'none',
                '@keyframes liminalityPulse': {
                  '0%, 100%': { opacity: 1, transform: 'scale(1)' },
                  '50%': { opacity: 0.45, transform: 'scale(0.85)' },
                },
              }}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {detail}
            </Typography>
          </Box>
          {listening ? (
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
        </Box>
        {listening ? (
          <LinearProgress
            variant="determinate"
            value={progress}
            color={barColor}
            sx={{ mt: 1.25, height: 8, borderRadius: 99 }}
          />
        ) : working ? (
          <LinearProgress sx={{ mt: 1.25, height: 8, borderRadius: 99 }} />
        ) : null}
      </Box>
    </Box>
  );
}
