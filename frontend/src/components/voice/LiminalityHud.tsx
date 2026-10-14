import { Box, Button, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { COMMAND_TIMEOUT_MS } from '../../voice/liminalityCommands';
import type { LiminalityPhase } from '../../hooks/useLiminalityVoice';
import LiveMicWaveform from './LiveMicWaveform';

const sheen = keyframes`
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
`;

const IRIDESCENT =
  'linear-gradient(90deg, #4cc9f0 0%, #7c5cff 18%, #f72585 38%, #ffd166 52%, #4cc9f0 68%, #7209b7 84%, #4cc9f0 100%)';

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
    ? Math.max(0.22, Math.min(1, remainingMs / COMMAND_TIMEOUT_MS))
    : 0.85;
  const title = working
    ? 'Working on it'
    : speaking
      ? 'Speaking'
      : 'Listening';
  const detail = working
    ? heard || 'Calculating that command'
    : speaking
      ? heard || statusLabel
      : waiting
        ? 'Say Liminality'
        : heard || 'Say a command. You do not need her name again.';

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
          position: 'relative',
          overflow: 'hidden',
          mx: 'auto',
          maxWidth: 520,
          px: 2.5,
          py: 1.5,
          borderRadius: 3,
          boxShadow: 8,
          color: '#fff',
          border: '1px solid',
          borderColor: waiting ? 'rgba(59,130,246,0.55)' : 'rgba(255,255,255,0.28)',
        }}
      >
        {waiting ? (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
            }}
          />
        ) : (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background: IRIDESCENT,
              backgroundSize: '220% 100%',
              animation: `${sheen} 7s linear infinite`,
              opacity: life,
              filter: `saturate(${0.85 + life * 0.5}) brightness(${0.7 + life * 0.45})`,
              transition: 'opacity 180ms linear, filter 180ms linear',
            }}
          />
        )}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: waiting
              ? 'linear-gradient(180deg, rgba(15,23,42,0.08) 0%, rgba(15,23,42,0.22) 100%)'
              : 'linear-gradient(180deg, rgba(15,23,42,0.12) 0%, rgba(15,23,42,0.32) 100%)',
          }}
        />
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 36 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {title}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }} noWrap>
              {detail}
            </Typography>
          </Box>
          {onCancel && !waiting ? (
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              data-liminality-cancel=""
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onCancel}
              sx={{
                pointerEvents: 'auto',
                textTransform: 'none',
                flexShrink: 0,
                borderColor: 'rgba(255,255,255,0.5)',
                color: '#fff',
              }}
            >
              Cancel
            </Button>
          ) : null}
        </Box>
        <Box sx={{ position: 'relative' }}>
          <LiveMicWaveform color="rgba(255,255,255,0.92)" />
        </Box>
      </Box>
    </Box>
  );
}
