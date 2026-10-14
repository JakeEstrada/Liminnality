import { Box, Button, Typography } from '@mui/material';
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

  const waiting = phase === 'waiting';
  const commandWindow = phase === 'listening';
  const working = phase === 'processing' || phase === 'executing';
  const speaking = phase === 'speaking';
  const life = commandWindow
    ? Math.max(0.18, Math.min(1, remainingMs / COMMAND_TIMEOUT_MS))
    : 0.9;
  const title = working ? 'Working' : speaking ? 'Speaking' : 'Listening';
  const detail = working
    ? heard || 'Looking that up'
    : speaking
      ? heard || statusLabel
      : waiting
        ? 'Say Liminality'
        : heard || 'Go ahead';

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1400,
        pointerEvents: 'none',
        px: 2,
        pb: 2,
      }}
    >
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          mx: 'auto',
          width: '100%',
          maxWidth: 340,
          px: 1.75,
          pt: 1,
          pb: 0.75,
          borderRadius: '22px',
          color: '#fff',
          background: waiting
            ? '#1976D2'
            : `linear-gradient(180deg, #1565C0 0%, #0D47A1 100%)`,
          boxShadow: waiting
            ? '0 8px 20px rgba(25, 118, 210, 0.28)'
            : `0 8px 24px rgba(13, 71, 161, ${0.18 + life * 0.22})`,
          outline: waiting ? 'none' : `1px solid rgba(255,255,255,${0.1 + life * 0.22})`,
          transition: 'box-shadow 200ms linear, outline-color 200ms linear',
        }}
      >
        {!waiting ? (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(105deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 42%, rgba(144,202,249,0.28) 100%)',
              opacity: life,
              transition: 'opacity 200ms linear',
            }}
          />
        ) : null}
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1, minHeight: 28 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.01em', lineHeight: 1.2 }}
              noWrap
            >
              {title}
            </Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 400, opacity: 0.78, lineHeight: 1.3 }} noWrap>
              {detail}
            </Typography>
          </Box>
          {onCancel && !waiting ? (
            <Button
              size="small"
              color="inherit"
              data-liminality-cancel=""
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onCancel}
              sx={{
                pointerEvents: 'auto',
                textTransform: 'none',
                flexShrink: 0,
                minWidth: 0,
                px: 1,
                py: 0.25,
                fontSize: 12,
                fontWeight: 500,
                lineHeight: 1.4,
                borderRadius: '999px',
                color: 'rgba(255,255,255,0.92)',
                bgcolor: 'rgba(255,255,255,0.12)',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
              }}
            >
              Cancel
            </Button>
          ) : null}
        </Box>
        <Box sx={{ position: 'relative', opacity: waiting ? 0.45 : 0.55 + life * 0.4 }}>
          <LiveMicWaveform color="rgba(255,255,255,0.88)" height={22} />
        </Box>
      </Box>
    </Box>
  );
}
