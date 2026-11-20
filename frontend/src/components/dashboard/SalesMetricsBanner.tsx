/**
 * Year-to-date sales versus the $800k baseline. Shown at the top of the dashboard.
 * API: GET /metrics
 */
import { useEffect, useState } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/axios';
import { formatMoney } from '../../utils/paymentSchedule';

type Compare = {
  amount: number;
  delta: number;
  deltaPct: number;
  pace: number;
  jobCount?: number;
};

type Metrics = {
  year: number;
  booked: Compare;
  collected: Compare;
  openEstimates?: { amount: number; jobCount: number };
};

function changeLabel(delta: number, pct: number) {
  const money = formatMoney(Math.abs(delta));
  const percent = `${Math.abs(pct).toFixed(1)}%`;
  if (delta > 0) return `Up ${money} (${percent})`;
  if (delta < 0) return `Down ${money} (${percent})`;
  return 'Even with the baseline';
}

export default function SalesMetricsBanner({ hideSensitive }: { hideSensitive: boolean }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Metrics>('/metrics')
      .then(({ data }) => {
        if (!cancelled) setMetrics(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!metrics) return null;

  const money = (value: number) => (hideSensitive ? 'Locked' : formatMoney(value));
  const bookedTone = metrics.booked.delta >= 0 ? theme.palette.success.main : theme.palette.error.main;
  const collectedTone = metrics.collected.delta >= 0 ? theme.palette.success.main : theme.palette.error.main;

  return (
    <Paper elevation={0} sx={{ mb: 3, p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      <Box sx={{ flex: '1 1 220px' }}>
        <Typography variant="overline" color="text.secondary">Booked {metrics.year}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>{money(metrics.booked.amount)}</Typography>
        <Typography variant="body2" sx={{ color: bookedTone, fontWeight: 700 }}>
          {hideSensitive ? 'Locked' : changeLabel(metrics.booked.delta, metrics.booked.deltaPct)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {metrics.booked.jobCount || 0} sold jobs · pace {money(metrics.booked.pace)}
        </Typography>
      </Box>
      <Box sx={{ flex: '1 1 220px' }}>
        <Typography variant="overline" color="text.secondary">Collected {metrics.year}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>{money(metrics.collected.amount)}</Typography>
        <Typography variant="body2" sx={{ color: collectedTone, fontWeight: 700 }}>
          {hideSensitive ? 'Locked' : changeLabel(metrics.collected.delta, metrics.collected.deltaPct)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Compared with $800,000 a year before these updates
        </Typography>
      </Box>
      <Button variant="outlined" onClick={() => navigate('/metrics')} sx={{ textTransform: 'none' }}>
        Sales metrics
      </Button>
    </Paper>
  );
}
