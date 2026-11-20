/**
 * MetricsPage — Booked and collected sales against the $800k baseline, plus advertising.
 * Route: /metrics (super admin)
 * APIs: GET /metrics, POST /metrics/ad-spend, DELETE /metrics/ad-spend/:id
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import api from '../utils/axios';
import { formatMoney } from '../utils/paymentSchedule';
import { AreaChart, ChartLegend, compactMoney, type ChartSeries } from '../components/dashboard/dashboardChartPrimitives';

type Compare = {
  amount: number;
  jobCount?: number;
  baselineToDate: number;
  delta: number;
  deltaPct: number;
  pace: number;
  paceDelta: number;
  pacePct: number;
};

type MonthRow = {
  month: string;
  label: string;
  booked: number;
  collected: number;
  baseline: number;
};

type AdRow = {
  id: string;
  label: string;
  jobs: number;
  booked: number;
  collected: number;
  spend: number;
  returnPerDollar: number | null;
  costPerJob: number | null;
  adClicks: number;
  contactSubmits: number;
  costPerClick: number | null;
};

type SourceRow = {
  id: string;
  label: string;
  jobs: number;
  booked: number;
  collected: number;
};

type SpendRow = {
  id: string;
  month: string;
  channel: string;
  amount: number;
  note: string;
};

type Metrics = {
  year: number;
  baselineAnnual: number;
  booked: Compare;
  openEstimates: { amount: number; jobCount: number };
  collected: Compare;
  monthly: MonthRow[];
  advertising: AdRow[];
  otherSources: SourceRow[];
  adSpend: SpendRow[];
  years: number[];
};

const CHANNELS = [
  { id: 'google', label: 'Google Ads' },
  { id: 'website', label: 'Website' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'yelp', label: 'Yelp' },
  { id: 'vehicle_advertisement', label: 'Vehicle advertisement' },
];

function errorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error) && error.response?.data?.error) return String(error.response.data.error);
  return fallback;
}

function directionLabel(delta: number, pct: number) {
  const money = formatMoney(Math.abs(delta));
  const percent = `${Math.abs(pct).toFixed(1)}%`;
  if (delta > 0) return `Up ${money} (${percent})`;
  if (delta < 0) return `Down ${money} (${percent})`;
  return 'Even with the baseline';
}

function moneyOrDash(value: number | null) {
  if (value == null) return '—';
  return formatMoney(value);
}

export default function MetricsPage() {
  const theme = useTheme();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [channel, setChannel] = useState('google');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async (nextYear: number) => {
    try {
      setLoading(true);
      const { data } = await api.get<Metrics>('/metrics', { params: { year: nextYear } });
      setMetrics(data);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to load metrics'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year);
  }, [load, year]);

  const saveSpend = async () => {
    const parsed = Number(String(amount).replace(/[$,]/g, ''));
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Enter the amount spent');
      return;
    }
    try {
      setSaving(true);
      await api.post('/metrics/ad-spend', { month, channel, amount: parsed, note });
      setAmount('');
      setNote('');
      await load(year);
      toast.success('Advertising spend saved');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save spend'));
    } finally {
      setSaving(false);
    }
  };

  const removeSpend = async (id: string) => {
    try {
      await api.delete(`/metrics/ad-spend/${id}`);
      await load(year);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not remove spend'));
    }
  };

  const series: ChartSeries[] = [
    { key: 'booked', label: 'Booked', color: theme.palette.primary.main },
    { key: 'collected', label: 'Collected', color: theme.palette.success.main },
    { key: 'baseline', label: 'Baseline', color: theme.palette.text.disabled },
  ];

  const chartData = (metrics?.monthly || []).map((row) => ({
    date: `${row.month}-01`,
    booked: row.booked,
    collected: row.collected,
    baseline: row.baseline,
  }));

  const years = metrics?.years?.length ? metrics.years : [year];
  const bookedTone = (metrics?.booked.delta || 0) >= 0 ? theme.palette.success.main : theme.palette.error.main;
  const collectedTone = (metrics?.collected.delta || 0) >= 0 ? theme.palette.success.main : theme.palette.error.main;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography variant="h1" sx={{ mb: 0.5 }}>Metrics</Typography>
          <Typography variant="body2" color="text.secondary">
            Booked sales are jobs that have left the estimate and moved into production. This shop stores those totals on the estimate field, so that amount is used when the contract field is empty. Open estimates are shown separately. The baseline is {formatMoney(800000)} a year, the run rate from before these updates, spread evenly through the year.
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          label="Year"
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          sx={{ minWidth: 120 }}
        >
          {years.map((value) => (
            <MenuItem key={value} value={value}>{value}</MenuItem>
          ))}
        </TextField>
      </Box>

      {loading && !metrics ? (
        <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Box>
      ) : metrics ? (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
            <Paper sx={{ p: 2.5, borderTop: `4px solid ${bookedTone}` }}>
              <Typography variant="overline" color="text.secondary">Booked this year</Typography>
              <Typography variant="h3" sx={{ fontWeight: 700 }}>{formatMoney(metrics.booked.amount)}</Typography>
              <Typography sx={{ color: bookedTone, fontWeight: 700, mt: 0.5 }}>
                {directionLabel(metrics.booked.delta, metrics.booked.deltaPct)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {metrics.booked.jobCount || 0} sold jobs. At this point in the year the baseline is {formatMoney(metrics.booked.baselineToDate)}.
                Full-year pace is {formatMoney(metrics.booked.pace)}, {directionLabel(metrics.booked.paceDelta, metrics.booked.pacePct).toLowerCase()} from {formatMoney(metrics.baselineAnnual)}.
                Open estimates are {formatMoney(metrics.openEstimates?.amount || 0)} across {metrics.openEstimates?.jobCount || 0} jobs and are not included above.
              </Typography>
            </Paper>
            <Paper sx={{ p: 2.5, borderTop: `4px solid ${collectedTone}` }}>
              <Typography variant="overline" color="text.secondary">Collected this year</Typography>
              <Typography variant="h3" sx={{ fontWeight: 700 }}>{formatMoney(metrics.collected.amount)}</Typography>
              <Typography sx={{ color: collectedTone, fontWeight: 700, mt: 0.5 }}>
                {directionLabel(metrics.collected.delta, metrics.collected.deltaPct)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Payments marked paid, dated by the paid date. Same {formatMoney(metrics.baselineAnnual)} baseline.
                Pace is {formatMoney(metrics.collected.pace)}.
              </Typography>
            </Paper>
          </Box>

          <Paper sx={{ p: 2.5, mb: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Month by month</Typography>
            <AreaChart data={chartData} series={series} formatValue={compactMoney} height={260} />
            <ChartLegend series={series} />
          </Paper>

          <Paper sx={{ p: 2.5, mb: 2 }}>
            <Typography variant="h6">Advertising</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Sales follow the source saved on the job. Spend is what you enter below. Google Ads clicks are site visits that arrived with an ad click id. Those clicks stay separate from jobs marked Website.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Channel</TableCell>
                  <TableCell align="right">Jobs</TableCell>
                  <TableCell align="right">Booked</TableCell>
                  <TableCell align="right">Collected</TableCell>
                  <TableCell align="right">Spend</TableCell>
                  <TableCell align="right">Return</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {metrics.advertising.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Typography variant="body2">{row.label}</Typography>
                      {row.id === 'google' ? (
                        <Typography variant="caption" color="text.secondary">
                          {row.adClicks} ad clicks · {row.contactSubmits} form sends
                          {row.costPerClick != null ? ` · ${formatMoney(row.costPerClick)} per click` : ''}
                        </Typography>
                      ) : row.costPerJob != null ? (
                        <Typography variant="caption" color="text.secondary">
                          {formatMoney(row.costPerJob)} per job
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">{row.jobs}</TableCell>
                    <TableCell align="right">{formatMoney(row.booked)}</TableCell>
                    <TableCell align="right">{formatMoney(row.collected)}</TableCell>
                    <TableCell align="right">{formatMoney(row.spend)}</TableCell>
                    <TableCell align="right">{row.returnPerDollar == null ? '—' : `${row.returnPerDollar.toFixed(2)}×`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2, alignItems: 'flex-start' }}>
              <TextField
                size="small"
                label="Month"
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                select
                size="small"
                label="Channel"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                sx={{ minWidth: 200 }}
              >
                {CHANNELS.map((row) => (
                  <MenuItem key={row.id} value={row.id}>{row.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                sx={{ width: 140 }}
              />
              <TextField
                size="small"
                label="Note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                sx={{ minWidth: 180, flex: 1 }}
              />
              <Button variant="contained" onClick={() => void saveSpend()} disabled={saving} sx={{ textTransform: 'none' }}>
                Save spend
              </Button>
            </Box>

            {metrics.adSpend.length ? (
              <Box sx={{ mt: 2 }}>
                {metrics.adSpend.map((row) => (
                  <Box
                    key={row.id || `${row.month}-${row.channel}`}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 2,
                      py: 0.75,
                      borderTop: `1px solid ${theme.palette.divider}`,
                    }}
                  >
                    <Typography variant="body2">
                      {row.month} · {CHANNELS.find((item) => item.id === row.channel)?.label || row.channel}
                      {row.note ? ` · ${row.note}` : ''}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2">{formatMoney(row.amount)}</Typography>
                      {row.id ? (
                        <Button size="small" onClick={() => void removeSpend(row.id)} sx={{ textTransform: 'none' }}>
                          Remove
                        </Button>
                      ) : null}
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : null}
          </Paper>

          <Paper sx={{ p: 2.5, bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Other sales</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Source</TableCell>
                  <TableCell align="right">Jobs</TableCell>
                  <TableCell align="right">Booked</TableCell>
                  <TableCell align="right">Collected</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {metrics.otherSources.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell align="right">{row.jobs}</TableCell>
                    <TableCell align="right">{formatMoney(row.booked)}</TableCell>
                    <TableCell align="right">{moneyOrDash(row.collected)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      ) : null}
    </Box>
  );
}
