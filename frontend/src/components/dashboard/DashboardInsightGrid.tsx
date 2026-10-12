import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import axios from 'axios';
import { eachDayOfInterval, format, parseISO, subDays } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, DonutChart, ScatterChart, chartPanelSx, compactMoney } from './dashboardChartPrimitives';
import OrangeCountyJobMap from './OrangeCountyJobMap';
import { formatMoney } from '../../utils/paymentSchedule';
import { useAuth } from '../../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type PaymentRow = {
  amount?: number;
  note?: string;
  paymentType?: string;
  resolvedPaymentPaidAt?: string;
  paymentPaidAt?: string;
  createdAt?: string;
};

type ActivityRow = {
  type?: string;
  createdAt?: string;
  note?: string;
  jobId?: { title?: string } | string;
  createdBy?: { name?: string };
};

type AuditEvent = {
  id?: string;
  type?: string;
  label?: string;
  occurredAt?: string;
  user?: { name?: string } | null;
};

type TrafficPoint = {
  date: string;
  pageViews?: number;
  visitors?: number;
  contactSubmits?: number;
};

type TeamPoint = {
  date: string;
  logins?: number;
  pageViews?: number;
  clicks?: number;
};

type PipelineSlice = {
  label: string;
  value: number;
  color: string;
};

function dayKeys(days: number) {
  const end = new Date();
  const start = subDays(end, days - 1);
  return eachDayOfInterval({ start, end }).map((date) => format(date, 'yyyy-MM-dd'));
}

function ymd(value?: string | Date | null) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'yyyy-MM-dd');
}

function activityBucket(type: string) {
  if (type === 'payment_received' || type === 'deposit_received') return 'payments';
  if (type === 'stage_change' || type === 'job_created' || type === 'job_updated') return 'pipeline';
  if (type === 'note' || type === 'manual_entry' || type === 'call' || type === 'email' || type === 'sms') {
    return 'notes';
  }
  if (String(type || '').startsWith('task') || String(type || '').startsWith('project')) return 'tasks';
  return 'other';
}

function shopActivityTitle(type?: string) {
  const labels: Record<string, string> = {
    stage_change: 'Stage change',
    note: 'Note',
    manual_entry: 'Note',
    job_created: 'Job created',
    job_updated: 'Job updated',
    job_archived: 'Job archived',
    task_completed: 'Task completed',
    task_created: 'Task created',
    appointment_created: 'Appointment',
    appointment_completed: 'Appointment done',
    payment_received: 'Payment',
    deposit_received: 'Deposit',
    payroll_printed: 'Payroll printed',
    call: 'Call',
    email: 'Email',
    sms: 'SMS',
  };
  if (type && labels[type]) return labels[type];
  return String(type || 'Activity').replace(/_/g, ' ');
}

function jobTitle(jobId?: ActivityRow['jobId']) {
  if (!jobId || typeof jobId === 'string') return '';
  return jobId.title || '';
}

export default function DashboardInsightGrid({
  hideSensitive,
  showTraffic,
  payments,
  activities,
  traffic,
  teamActivity,
  pipeline,
  canOpenFinance: _canOpenFinance,
  layout = 'full',
}: {
  hideSensitive: boolean;
  showTraffic: boolean;
  payments: PaymentRow[];
  activities: ActivityRow[];
  traffic: TrafficPoint[] | null;
  teamActivity: TeamPoint[] | null;
  pipeline: PipelineSlice[];
  canOpenFinance: boolean;
  layout?: 'full' | 'kiosk';
}) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canLoadAudit = user?.role === 'super_admin';
  const days = useMemo(() => dayKeys(30), []);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const paymentPoints = useMemo(() => {
    return payments
      .map((row) => {
        const stamp = row.resolvedPaymentPaidAt || row.paymentPaidAt || row.createdAt;
        const time = stamp ? new Date(stamp).getTime() : NaN;
        const note = String(row.note || '').replace(/^Payment received:\s*/i, '').trim();
        return {
          t: time,
          y: Number(row.amount) || 0,
          label: note || String(row.paymentType || 'Payment').replace(/_/g, ' '),
        };
      })
      .filter((point) => Number.isFinite(point.t) && point.y > 0);
  }, [payments]);

  const activitySeries = useMemo(() => {
    const bucket = new Map(
      days.map((date) => [date, { date, pipeline: 0, notes: 0, tasks: 0, other: 0 }]),
    );
    for (const row of activities) {
      const date = ymd(row.createdAt);
      const current = bucket.get(date);
      if (!current) continue;
      const key = activityBucket(String(row.type || ''));
      if (key === 'payments') {
        current.other += 1;
        continue;
      }
      current[key] += 1;
    }
    return days.map((date) => bucket.get(date)!);
  }, [activities, days]);

  const trafficSeries = useMemo(() => {
    if (!traffic?.length) return days.map((date) => ({ date, pageViews: 0, visitors: 0, contactSubmits: 0 }));
    const bucket = new Map(traffic.map((row) => [row.date, row]));
    return days.map((date) => ({
      date,
      pageViews: Number(bucket.get(date)?.pageViews) || 0,
      visitors: Number(bucket.get(date)?.visitors) || 0,
      contactSubmits: Number(bucket.get(date)?.contactSubmits) || 0,
    }));
  }, [days, traffic]);

  const auditHasData = Boolean(
    teamActivity?.some((row) => (Number(row.pageViews) || 0) + (Number(row.clicks) || 0) + (Number(row.logins) || 0) > 0),
  );

  const teamSeries = useMemo(() => {
    if (!auditHasData) return activitySeries;
    const bucket = new Map((teamActivity || []).map((row) => [row.date, row]));
    return days.map((date) => ({
      date,
      pipeline: Number(bucket.get(date)?.pageViews) || 0,
      notes: Number(bucket.get(date)?.clicks) || 0,
      tasks: Number(bucket.get(date)?.logins) || 0,
      other: 0,
    }));
  }, [activitySeries, auditHasData, days, teamActivity]);

  const dayActivities = useMemo(() => {
    if (!selectedDay) return [];
    return activities.filter((row) => ymd(row.createdAt) === selectedDay);
  }, [activities, selectedDay]);

  useEffect(() => {
    if (!selectedDay || !canLoadAudit) {
      setAuditEvents([]);
      setAuditLoading(false);
      return undefined;
    }
    let cancelled = false;
    setAuditLoading(true);
    axios
      .get(`${API_URL}/audit-logs`, {
        params: {
          from: `${selectedDay}T00:00:00`,
          to: `${selectedDay}T23:59:59.999`,
          limit: 200,
        },
      })
      .then(({ data }) => {
        if (!cancelled) setAuditEvents(Array.isArray(data?.events) ? data.events : []);
      })
      .catch(() => {
        if (!cancelled) setAuditEvents([]);
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadAudit, selectedDay]);

  const paymentTotal = paymentPoints.reduce((sum, row) => sum + row.y, 0);
  const activityTotal = activitySeries.reduce(
    (sum, row) => sum + row.pipeline + row.notes + row.tasks + row.other,
    0,
  );
  const trafficTotal = trafficSeries.reduce((sum, row) => sum + row.pageViews, 0);
  const money = (value: number) => (hideSensitive ? 'Locked' : formatMoney(value));
  const axisMoney = (value: number) => (hideSensitive ? String(Math.round(value)) : compactMoney(value));

  const kiosk = layout === 'kiosk';
  const chartHeight = kiosk ? 148 : 200;
  const showSecondGraph = showTraffic || kiosk;
  const compactPanel = {
    ...chartPanelSx(theme),
    minHeight: kiosk ? 0 : { md: 320 },
    height: 'auto',
    flexShrink: kiosk ? 0 : undefined,
  };

  return (
    <Box
      sx={{
        mb: kiosk ? 0 : 3,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        flex: kiosk ? 1 : undefined,
        minHeight: kiosk ? 0 : undefined,
        height: kiosk ? '100%' : undefined,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: showSecondGraph ? '1fr 1fr' : '1fr' },
          gap: 2,
          alignItems: 'stretch',
          flexShrink: 0,
        }}
      >
        <Paper elevation={0} sx={compactPanel}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
            Team activity
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {auditHasData
              ? 'Pages, clicks, and sign-ins in Paarth · click a day to see what happened'
              : `Shop work logged in Paarth · ${activityTotal} events · click a day to see what happened`}
          </Typography>
          <AreaChart
            data={teamSeries}
            height={chartHeight}
            series={
              auditHasData
                ? [
                    { key: 'pipeline', label: 'Pages', color: '#818cf8' },
                    { key: 'notes', label: 'Clicks', color: '#fbbf24' },
                    { key: 'tasks', label: 'Sign-ins', color: '#f472b6' },
                  ]
                : [
                    { key: 'pipeline', label: 'Pipeline', color: '#818cf8' },
                    { key: 'notes', label: 'Notes', color: '#fbbf24' },
                    { key: 'tasks', label: 'Tasks', color: '#f472b6' },
                    { key: 'other', label: 'Other', color: '#38bdf8' },
                  ]
            }
            showDots
            onDayClick={setSelectedDay}
          />
        </Paper>
        {showTraffic ? (
          <Paper elevation={0} sx={compactPanel}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 1 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Website traffic
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Public site · {trafficTotal} page views
                </Typography>
              </Box>
              {!kiosk ? (
                <Button size="small" onClick={() => navigate('/developer?section=analytics')} sx={{ textTransform: 'none' }}>
                  Analytics
                </Button>
              ) : null}
            </Box>
            <AreaChart
              height={chartHeight}
              data={trafficSeries}
              series={[
                { key: 'pageViews', label: 'Page views', color: '#60a5fa' },
                { key: 'visitors', label: 'Visitors', color: '#c084fc' },
                { key: 'contactSubmits', label: 'Messages', color: '#fb923c' },
              ]}
            />
          </Paper>
        ) : kiosk ? (
          <Paper elevation={0} sx={compactPanel}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              Pipeline mix
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Active jobs by stage group
            </Typography>
            <DonutChart
              slices={pipeline}
              centerLabel="jobs"
              centerValue={String(pipeline.reduce((sum, slice) => sum + slice.value, 0))}
            />
          </Paper>
        ) : null}
      </Box>

      <OrangeCountyJobMap hideSensitive={hideSensitive} kiosk={kiosk} />

      <Dialog
        open={Boolean(selectedDay)}
        onClose={() => setSelectedDay(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {selectedDay
            ? format(parseISO(`${selectedDay}T12:00:00`), 'EEEE, MMM d')
            : 'Team activity'}
        </DialogTitle>
        <DialogContent>
          {auditLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : null}
          {!auditLoading && dayActivities.length === 0 && auditEvents.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              Nothing logged this day.
            </Typography>
          ) : null}
          {dayActivities.length > 0 ? (
            <Box sx={{ mb: auditEvents.length ? 2.5 : 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Shop work
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {dayActivities.map((row, index) => (
                  <Box
                    key={`${row.createdAt || 'act'}-${index}`}
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                      <Chip
                        size="small"
                        label={shopActivityTitle(row.type)}
                        sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {row.createdAt ? format(new Date(row.createdAt), 'h:mm a') : ''}
                        {row.createdBy?.name ? ` · ${row.createdBy.name}` : ''}
                      </Typography>
                    </Box>
                    {row.note ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {row.note}
                      </Typography>
                    ) : null}
                    {jobTitle(row.jobId) ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                        {jobTitle(row.jobId)}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
          {auditEvents.length > 0 ? (
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Pages, clicks, and sign-ins
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {auditEvents.map((event, index) => (
                  <Box
                    key={event.id || `${event.occurredAt}-${index}`}
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {event.label || event.type}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {event.occurredAt ? format(new Date(event.occurredAt), 'h:mm a') : ''}
                      {event.user?.name ? ` · ${event.user.name}` : ''}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>

      {kiosk ? null : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.7fr) minmax(280px, 0.9fr)' },
            gap: 2,
            alignItems: 'stretch',
          }}
        >
          <Paper elevation={0} sx={compactPanel}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 1 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Payments collected
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Last 30 days · {paymentPoints.length} payments · {money(paymentTotal)}
                </Typography>
              </Box>
            </Box>
            <ScatterChart
              height={200}
              points={paymentPoints}
              formatValue={hideSensitive ? undefined : axisMoney}
              hideSensitive={hideSensitive}
            />
          </Paper>
          <Paper elevation={0} sx={compactPanel}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              Pipeline mix
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Active jobs by stage group
            </Typography>
            <DonutChart
              slices={pipeline}
              centerLabel="jobs"
              centerValue={String(pipeline.reduce((sum, slice) => sum + slice.value, 0))}
            />
          </Paper>
        </Box>
      )}
    </Box>
  );
}
