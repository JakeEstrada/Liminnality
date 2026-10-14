import { Box, Button, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { COMMAND_TIMEOUT_MS } from '../../voice/liminalityCommands';
import type { LiminalityPhase } from '../../hooks/useLiminalityVoice';
import LiveMicWaveform from './LiveMicWaveform';

const sheen = keyframes`
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
`;

const bloom = keyframes`
  0%, 100% { opacity: 0.72; }
  50% { opacity: 1; }
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
  const active = !waiting;
  const life = waiting
    ? 0.16
    : commandWindow
      ? Math.max(0.14, Math.min(1, remainingMs / COMMAND_TIMEOUT_MS))
      : 0.78;
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
      }}
    >
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          px: { xs: 2, sm: 3 },
          pt: 1.5,
          pb: 1.25,
          color: active ? '#fff' : 'rgba(255,255,255,0.78)',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: IRIDESCENT,
            backgroundSize: '220% 100%',
            animation: `${sheen} 7s linear infinite`,
            opacity: life,
            filter: `saturate(${0.7 + life * 0.8}) brightness(${0.55 + life * 0.7})`,
            transition: 'opacity 180ms linear, filter 180ms linear',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 18,
            background: IRIDESCENT,
            backgroundSize: '220% 100%',
            animation: `${sheen} 7s linear infinite, ${bloom} 2.8s ease-in-out infinite`,
            filter: 'blur(10px)',
            opacity: 0.35 + life * 0.65,
            pointerEvents: 'none',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: waiting
              ? 'linear-gradient(180deg, rgba(8,10,18,0.22) 0%, rgba(8,10,18,0.72) 100%)'
              : 'linear-gradient(180deg, rgba(8,10,18,0.08) 0%, rgba(8,10,18,0.38) 100%)',
          }}
        />
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 36 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {title}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.86 }} noWrap>
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
                borderColor: 'rgba(255,255,255,0.45)',
                color: '#fff',
              }}
            >
              Cancel
            </Button>
          ) : null}
        </Box>
        <Box sx={{ position: 'relative', opacity: 0.55 + life * 0.45 }}>
          <LiveMicWaveform color="rgba(255,255,255,0.92)" />
        </Box>
      </Box>
    </Box>
  );
}
