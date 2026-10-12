/**
 * DashboardPage — Home: stats, upcoming work, activity feed, AI summary.
 * Route: /dashboard
 * APIs: GET /activities/recent, POST /activities/summary
 * Docs: ../../../docs/PAGES.md#dashboardpagetsx
 */
// @ts-nocheck — large page; tighten types incrementally
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  GridLegacy as Grid,
  Paper,
  Typography,
  CircularProgress,
  Chip,
  Divider,
  Button,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  LinearProgress,
  Tooltip,
  alpha,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  AccountTree as JobsIcon,
  AttachMoney as MoneyIcon,
  CalendarToday as CalendarIcon,
  Assignment as TasksIcon,
  Dashboard as DashboardHomeIcon,
  TrendingUp as TrendingUpIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  People as PeopleIcon,
  Note as NoteIcon,
  Print as PrintIcon,
  Delete as DeleteIcon,
  AutoAwesome as AutoAwesomeIcon,
  ChevronRight as ChevronRightIcon,
  Sms as SmsIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatMoney, roundMoney, getJobPaymentSummary, formatPaidScheduleItemLabel, resolvePaymentSchedule } from '../utils/paymentSchedule';
import toast from 'react-hot-toast';
import { format, isToday, isTomorrow, parseISO, formatDistanceToNow, subDays } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import BrandLogo from '../components/common/BrandLogo';
import PaymentNotificationSettings from '../components/finance/PaymentNotificationSettings';
import { sendUnsentPaymentNotifications, sendManualPaymentNotification } from '../utils/paymentNotificationSettingsApi';
import { APP_LOGO_LIGHT } from '../utils/tenantBranding';
import { useShopViewSensitive } from '../hooks/useShopViewSensitive';
import { renderSummaryBlocks } from '../utils/summaryMarkdown';
import { useTenantRealtimeRefresh } from '../hooks/useSocketSubscription';
import { getTenantRoom } from '../services/socket';
import DashboardInsightGrid from '../components/dashboard/DashboardInsightGrid';
import KioskViewNav from '../components/layout/KioskViewNav';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const ESTIMATE_STAGES = [
  'APPOINTMENT_SCHEDULED',
  'ESTIMATE_IN_PROGRESS',
  'ESTIMATE_SENT',
  'ENGAGED_DESIGN_REVIEW',
  'CONTRACT_OUT',
];
const PRODUCTION_STAGES = [
  'DEPOSIT_PENDING',
  'JOB_PREP',
  'TAKEOFF_COMPLETE',
  'READY_TO_SCHEDULE',
  'SCHEDULED',
  'IN_PRODUCTION',
];
const INSTALLED_STAGES = ['INSTALLED', 'FINAL_PAYMENT_CLOSED'];

function parsePaymentReceivedLabel(activity) {
  const note = String(activity?.note || '').trim();
  const prefix = 'Payment received: ';
  if (note.startsWith(prefix)) return note.slice(prefix.length);
  if (note) return note;
  if (activity?.paymentType) {
    return activity.paymentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'Payment';
}

function lookupSchedulePaidAt(activity, jobsById) {
  if (activity?.paymentPaidAt) return activity.paymentPaidAt;

  const jobId = String(activity?.jobId?._id || activity?.jobId || '');
  const job = jobsById.get(jobId);
  const items = job?.paymentSchedule?.items;
  if (!Array.isArray(items) || items.length === 0) return null;

  const activityLabel = parsePaymentReceivedLabel(activity).toLowerCase();
  const activityAmount = roundMoney(Number(activity?.amount) || 0);

  for (const item of items) {
    if (item.status !== 'paid') continue;
    const itemLabel = String(item.label || '').trim().toLowerCase();
    const itemAmount = roundMoney(Number(item.paidAmount ?? item.amount) || 0);
    if (itemLabel && activityLabel.includes(itemLabel) && Math.abs(itemAmount - activityAmount) < 0.02) {
      return item.paidAt || null;
    }
  }

  for (const item of items) {
    if (item.status !== 'paid') continue;
    const itemLabel = String(item.label || '').trim().toLowerCase();
    if (itemLabel && activityLabel.includes(itemLabel)) {
      return item.paidAt || null;
    }
  }

  return null;
}

function lookupSchedulePaidItem(activity, jobsById) {
  const jobId = String(activity?.jobId?._id || activity?.jobId || '');
  const job = jobsById.get(jobId);
  const items = job?.paymentSchedule?.items;
  if (!Array.isArray(items) || items.length === 0) return null;

  const activityLabel = parsePaymentReceivedLabel(activity).toLowerCase();
  const labelBeforeColon = activityLabel.split(':')[0]?.trim() || activityLabel;

  for (const item of items) {
    if (item.status !== 'paid') continue;
    const itemLabel = String(item.label || '').trim().toLowerCase();
    if (!itemLabel) continue;
    if (
      activityLabel.includes(itemLabel) ||
      labelBeforeColon === itemLabel ||
      labelBeforeColon.startsWith(itemLabel)
    ) {
      return item;
    }
  }

  return null;
}

function enrichMarkedPaidPayment(activity, jobsById) {
  const jobId = String(activity?.jobId?._id || activity?.jobId || '');
  const job = jobsById.get(jobId);
  const jobBalanceDue = job ? getJobPaymentSummary(job).balanceDue : null;
  const scheduleItem = lookupSchedulePaidItem(activity, jobsById);
  const amount = scheduleItem
    ? roundMoney(Number(scheduleItem.paidAmount ?? scheduleItem.amount) || 0)
    : roundMoney(Number(activity.amount) || 0);
  const paymentLabel = scheduleItem
    ? formatPaidScheduleItemLabel(scheduleItem)
    : parsePaymentReceivedLabel(activity);
  return {
    ...activity,
    amount,
    paymentLabel,
    resolvedPaymentPaidAt:
      scheduleItem?.paidAt || lookupSchedulePaidAt(activity, jobsById),
    jobBalanceDue,
  };
}

function paidRowMatchKey(jobId, label) {
  return `${String(jobId)}|${String(label || '').trim().toLowerCase()}`;
}

function extractPaymentLabelKey(activity) {
  const label = activity?.paymentLabel || parsePaymentReceivedLabel(activity);
  return String(label).split(':')[0]?.trim().toLowerCase() || '';
}

function buildSyntheticPaidActivities(jobs) {
  const rows = [];
  for (const job of jobs) {
    if (!job || job.isArchived || job.isDeadEstimate) continue;
    const schedule = resolvePaymentSchedule(job);
    for (const item of schedule.items || []) {
      if (item.status !== 'paid') continue;
      const label = String(item.label || '').trim();
      if (!label) continue;
      const paymentLabel = formatPaidScheduleItemLabel(item);
      rows.push({
        _id: `schedule-paid-${job._id}-${item.sortOrder}-${label}`,
        synthetic: true,
        type: 'payment_received',
        jobId: job,
        customerId: job.customerId,
        amount: roundMoney(Number(item.paidAmount ?? item.amount) || 0),
        paymentPaidAt: item.paidAt,
        createdAt: item.paidAt || job.updatedAt || job.createdAt || new Date().toISOString(),
        note: `Payment received: ${paymentLabel}`,
        paymentLabel,
      });
    }
  }
  return rows;
}

function mergeMarkedPaidPayments(activities, jobs) {
  const jobsById = new Map(jobs.map((job) => [String(job._id), job]));
  const fromActivities = (activities || []).map((activity) =>
    enrichMarkedPaidPayment(activity, jobsById),
  );
  const coveredKeys = new Set(
    fromActivities.map((activity) => {
      const jobId = String(activity.jobId?._id || activity.jobId || '');
      return paidRowMatchKey(jobId, extractPaymentLabelKey(activity));
    }),
  );

  const synthetic = buildSyntheticPaidActivities(jobs)
    .filter((row) => {
      const jobId = String(row.jobId?._id || row.jobId || '');
      const labelKey = extractPaymentLabelKey(row);
      return !coveredKeys.has(paidRowMatchKey(jobId, labelKey));
    })
    .map((row) => enrichMarkedPaidPayment(row, jobsById));

  return [...fromActivities, ...synthetic].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

const AI_SUMMARY_HOVER_JOKE =
  'Tired of looking through big ass work logs... fuck that. Have AI generate a summary of that shit.';

/** Long feeds scroll inside their panel so the page keeps a predictable height. */
const dashboardScrollListSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  overflowY: 'auto',
  pr: 0.5,
  mr: -0.5,
};

function dashboardPanelSx(theme) {
  return {
    p: { xs: 2, sm: 2.5 },
    borderRadius: 3,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
    boxShadow:
      theme.palette.mode === 'dark'
        ? '0 1px 0 rgba(255,255,255,0.04)'
        : '0 1px 3px rgba(15, 23, 42, 0.06)',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  };
}

function DashboardStatCard({ label, value, icon: Icon, accentColor, theme }) {
  return (
    <Paper elevation={0} sx={{ ...dashboardPanelSx(theme), borderLeft: `4px solid ${accentColor}` }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.68rem' }}
          >
            {label}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.75, lineHeight: 1.15, fontSize: { xs: '1.35rem', sm: '1.75rem' } }}>
            {value}
          </Typography>
        </Box>
        <Box
          sx={{
            width: 42,
            height: 42,
            borderRadius: 2,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.18 : 0.1),
          }}
        >
          <Icon sx={{ fontSize: 22, color: accentColor }} />
        </Box>
      </Box>
    </Paper>
  );
}

function DashboardQuickTile({ label, value, icon: Icon, accentColor, onClick, alert, theme }) {
  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        p: { xs: 1.75, sm: 2 },
        borderRadius: 3,
        border: '1px solid',
        borderColor: alert ? 'error.main' : 'divider',
        bgcolor: alert ? alpha(theme.palette.error.main, 0.06) : 'background.paper',
        cursor: onClick ? 'pointer' : 'default',
        width: '100%',
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        '&:hover': onClick
          ? {
              transform: 'translateY(-1px)',
              boxShadow: theme.palette.mode === 'dark' ? '0 6px 18px rgba(0,0,0,0.35)' : '0 6px 16px rgba(15,23,42,0.08)',
            }
          : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', minWidth: 0 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(accentColor, 0.12),
            flexShrink: 0,
          }}
        >
          <Icon sx={{ fontSize: 20, color: accentColor }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
            {value}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ display: 'block', fontWeight: 500 }}
          >
            {label}
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}

function DashboardPanelHeader({ title, actionLabel, onAction, subtitle, headerActions }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2, gap: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, flexShrink: 0 }}>
        {headerActions}
        {actionLabel && onAction ? (
          <Button
            size="small"
            endIcon={<ChevronRightIcon sx={{ fontSize: 18 }} />}
            onClick={onAction}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
          >
            {actionLabel}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

function DashboardEmptyState({ message }) {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
        px: 2,
        borderRadius: 2,
        border: '1px dashed',
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        {message}
      </Typography>
    </Box>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const { user, tenantIdForBranding, isSuperAdmin } = useAuth();
  const { hideSensitive } = useShopViewSensitive(user?.role);
  const canEditPaymentAlerts = ['super_admin', 'admin'].includes(user?.role);
  const canOpenFinanceHub = user?.role === 'super_admin';
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalJobs: 0,
    activeJobs: 0,
    totalRevenue: 0,
    contractedRevenue: 0,
    potentialRevenue: 0,
    upcomingAppointments: [],
    pendingTasks: [],
    urgentTasks: [],
    totalCustomers: 0,
    pipelineMix: [
      { label: 'Estimate', value: 0, color: '#f59e0b' },
      { label: 'In production', value: 0, color: '#6366f1' },
      { label: 'Installed', value: 0, color: '#10b981' },
    ],
  });
  const [activities, setActivities] = useState([]);
  const [chartActivities, setChartActivities] = useState([]);
  const [trafficSeries, setTrafficSeries] = useState(null);
  const [teamActivity, setTeamActivity] = useState(null);
  const [markedPaidPayments, setMarkedPaidPayments] = useState([]);
  const [sendingUnsentPaymentAlerts, setSendingUnsentPaymentAlerts] = useState(false);
  const [paymentContextMenu, setPaymentContextMenu] = useState(null);
  const [paymentContextActivity, setPaymentContextActivity] = useState(null);
  const [sendingPaymentAlertKey, setSendingPaymentAlertKey] = useState(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedPrintDate, setSelectedPrintDate] = useState(new Date().toISOString().split('T')[0]);
  const [summaryStartDate, setSummaryStartDate] = useState(() =>
    format(subDays(new Date(), 6), 'yyyy-MM-dd')
  );
  const [summaryEndDate, setSummaryEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [summarySetupDialogOpen, setSummarySetupDialogOpen] = useState(false);
  const [summaryResultDialogOpen, setSummaryResultDialogOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryUserPrompt, setSummaryUserPrompt] = useState('');
  const [summaryText, setSummaryText] = useState('');
  const [summaryActivityCount, setSummaryActivityCount] = useState(null);
  const [summaryTotalInRange, setSummaryTotalInRange] = useState(null);
  const [summaryNewestAt, setSummaryNewestAt] = useState(null);
  const [summaryGeneratedAt, setSummaryGeneratedAt] = useState(null);
  const [summaryTruncated, setSummaryTruncated] = useState(false);
  /** Last successful request — used for "Refresh" to re-query DB + regenerate (no caching). */
  const [summaryLastRequest, setSummaryLastRequest] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [activityToDelete, setActivityToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [manualActivityTime, setManualActivityTime] = useState('');
  const [manualActivityNote, setManualActivityNote] = useState('');
  const [savingManualActivity, setSavingManualActivity] = useState(false);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    // Load dashboard data once on mount; no auto-refresh to avoid
    // scrolling the page back to the top while you're reading.
    fetchDashboardData();

    const onFocus = () => {
      fetchDashboardData();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Only show full-page loading on first load; background refetches keep
      // existing content mounted so scroll position is preserved.
      if (isInitialLoad.current) {
        setLoading(true);
        isInitialLoad.current = false;
      }
      
      // Fetch all data in parallel
      const paymentHistoryStart = format(subDays(new Date(), 365), 'yyyy-MM-dd');
      const paymentHistoryEnd = format(new Date(), 'yyyy-MM-dd');
      const chartStart = format(subDays(new Date(), 29), 'yyyy-MM-dd');
      const superAdmin = user?.role === 'super_admin';
      const [jobsRes, appointmentsRes, tasksRes, customersRes, activitiesRes, markedPaidRes, chartActivitiesRes, trafficRes, teamRes] = await Promise.all([
        axios.get(`${API_URL}/jobs`),
        axios.get(`${API_URL}/appointments?status=scheduled&limit=50`),
        axios.get(`${API_URL}/tasks`),
        axios.get(`${API_URL}/customers?limit=1`),
        axios.get(`${API_URL}/activities/recent?limit=100`).catch(() => ({ data: [] })),
        axios
          .get(
            `${API_URL}/activities/date-range?startDate=${paymentHistoryStart}&endDate=${paymentHistoryEnd}&types=payment_received`,
          )
          .catch((err) => {
            console.error('Failed to load marked paid payments:', err);
            return { data: [] };
          }),
        axios
          .get(`${API_URL}/activities/date-range?startDate=${chartStart}&endDate=${paymentHistoryEnd}`)
          .catch(() => ({ data: [] })),
        superAdmin
          ? axios.get(`${API_URL}/website/analytics/report?days=30&hideMine=1`).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
        superAdmin
          ? axios.get(`${API_URL}/audit-logs/summary?days=30`).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
      ]);

      const jobs = jobsRes.data.jobs || jobsRes.data || [];
      const jobsById = new Map(jobs.map((job) => [String(job._id), job]));
      const appointments = appointmentsRes.data.appointments || appointmentsRes.data || [];
      const tasks = tasksRes.data.tasks || tasksRes.data || [];
      const customersResData = customersRes.data;
      const customerTotal = customersResData?.total ?? (Array.isArray(customersResData?.customers) ? customersResData.customers.length : 0);
      const allActivities = activitiesRes.data || [];
      const paidActivities = Array.isArray(markedPaidRes.data) ? markedPaidRes.data : [];

      // Filter out archived and dead estimates
      const activeJobs = jobs.filter(job => !job.isArchived && !job.isDeadEstimate);

      // Calculate revenue
      const totalRevenue = activeJobs.reduce((sum, job) => sum + (job.valueEstimated || 0), 0);
      const contractedRevenue = activeJobs
        .filter(job => ['DEPOSIT_PENDING', 'JOB_PREP', 'TAKEOFF_COMPLETE', 'READY_TO_SCHEDULE', 'SCHEDULED', 'IN_PRODUCTION', 'INSTALLED', 'FINAL_PAYMENT_CLOSED'].includes(job.stage))
        .reduce((sum, job) => sum + (job.valueContracted || job.valueEstimated || 0), 0);
      const potentialRevenue = activeJobs
        .filter(job => ['APPOINTMENT_SCHEDULED', 'ESTIMATE_IN_PROGRESS', 'ESTIMATE_SENT', 'ENGAGED_DESIGN_REVIEW', 'CONTRACT_OUT'].includes(job.stage))
        .reduce((sum, job) => sum + (job.valueEstimated || 0), 0);

      // Upcoming appointments: scheduled, date in next 7 days (use date field; model has date + time)
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const nextWeekEnd = new Date(todayStart.getTime() + 8 * 24 * 60 * 60 * 1000);
      const upcomingAppointments = appointments
        .filter(apt => {
          if (!apt.date) return false;
          const aptDate = new Date(apt.date);
          const aptDayStart = new Date(aptDate.getFullYear(), aptDate.getMonth(), aptDate.getDate(), 0, 0, 0, 0);
          return aptDayStart >= todayStart && aptDayStart < nextWeekEnd;
        })
        .sort((a, b) => {
          const dA = new Date(a.date);
          const dB = new Date(b.date);
          if (dA.getTime() !== dB.getTime()) return dA - dB;
          const tA = (a.time || '').toLowerCase();
          const tB = (b.time || '').toLowerCase();
          return tA.localeCompare(tB);
        })
        .slice(0, 5);

      // Tasks
      const pendingTasks = tasks.filter(task => !task.completedAt).slice(0, 5);
      const urgentTasks = tasks.filter(task => !task.completedAt && !!task.isUrgent).slice(0, 5);

      // Sort activities by date (most recent first)
      const sortedActivities = [...allActivities].sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateB - dateA;
      });

      setStats({
        totalJobs: activeJobs.length,
        activeJobs: activeJobs.length,
        totalRevenue,
        contractedRevenue,
        potentialRevenue,
        upcomingAppointments,
        pendingTasks,
        urgentTasks,
        totalCustomers: customerTotal,
        pipelineMix: (() => {
          const estimate = activeJobs.filter((job) => ESTIMATE_STAGES.includes(job.stage)).length;
          const production = activeJobs.filter((job) => PRODUCTION_STAGES.includes(job.stage)).length;
          const installed = activeJobs.filter((job) => INSTALLED_STAGES.includes(job.stage)).length;
          const other = Math.max(0, activeJobs.length - estimate - production - installed);
          return [
            { label: 'Estimate', value: estimate, color: '#f59e0b' },
            { label: 'In production', value: production, color: '#6366f1' },
            { label: 'Installed', value: installed, color: '#10b981' },
            ...(other ? [{ label: 'Other', value: other, color: '#94a3b8' }] : []),
          ];
        })(),
      });
      setActivities(sortedActivities);
      setChartActivities(Array.isArray(chartActivitiesRes.data) ? chartActivitiesRes.data : []);
      setTrafficSeries(Array.isArray(trafficRes?.data?.series) ? trafficRes.data.series : null);
      setTeamActivity(Array.isArray(teamRes?.data?.series) ? teamRes.data.series : null);
      setMarkedPaidPayments(mergeMarkedPaidPayments(paidActivities, jobs));
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const tenantRoom = getTenantRoom(tenantIdForBranding);
  useTenantRealtimeRefresh(tenantRoom, () => {
    fetchDashboardData();
  }, { ignoreOwnWrites: false, debounceMs: 400 });

  const handleManualActivitySubmit = async (event) => {
    event.preventDefault();
    if (!manualActivityNote.trim()) {
      toast.error('Please enter what you worked on.');
      return;
    }

    try {
      setSavingManualActivity(true);

      let createdAt;
      if (manualActivityTime) {
        // Use today's date with the supplied time (HH:mm)
        const now = new Date();
        const [hours, minutes] = manualActivityTime.split(':');
        const customDate = new Date(now);
        customDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
        createdAt = customDate.toISOString();
      }

      const payload = {
        type: 'manual_entry',
        note: manualActivityNote.trim(),
      };

      if (createdAt) {
        payload.createdAt = createdAt;
      }

      const response = await axios.post(`${API_URL}/activities/manual`, payload);

      // Optimistically prepend the new activity into the feed
      setActivities(prev => [response.data, ...prev]);
      setManualActivityNote('');
      setManualActivityTime('');
      toast.success('Activity added to timeline');
    } catch (error) {
      console.error('Error creating manual activity:', error);
      toast.error('Failed to add activity');
    } finally {
      setSavingManualActivity(false);
    }
  };

  const formatCurrency = formatMoney;

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = parseISO(dateString);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'MMM dd, yyyy');
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    return format(parseISO(dateString), 'h:mm a');
  };

  const getActivityTitle = (activity) => {
    switch (activity.type) {
      case 'stage_change':
        const STAGE_LABELS = {
          APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
          ESTIMATE_IN_PROGRESS: 'Estimate In Progress',
          ESTIMATE_SENT: 'Estimate Sent',
          ENGAGED_DESIGN_REVIEW: 'Design Review',
          CONTRACT_OUT: 'Contract Out',
          CONTRACT_SIGNED: 'Contract Signed',
          DEPOSIT_PENDING: 'Deposit Pending',
          JOB_PREP: 'Job Prep',
          TAKEOFF_COMPLETE: 'Fabrication',
          READY_TO_SCHEDULE: 'Ready to Schedule',
          SCHEDULED: 'Scheduled',
          IN_PRODUCTION: 'In Production',
          INSTALLED: 'Installed',
          FINAL_PAYMENT_CLOSED: 'Final Payment Closed',
        };
        const fromLabel = activity.fromStage ? (STAGE_LABELS[activity.fromStage] || activity.fromStage) : 'Unknown';
        const toLabel = activity.toStage ? (STAGE_LABELS[activity.toStage] || activity.toStage) : 'Unknown';
        return `Stage: ${fromLabel} → ${toLabel}`;
      case 'note':
        return 'Note';
      case 'job_created':
        return 'Job Created';
      case 'job_updated':
        return 'Job Updated';
      case 'job_archived':
        return 'Job Archived';
      case 'file_uploaded':
        return 'File Uploaded';
      case 'file_deleted':
        return 'File Deleted';
      case 'meeting':
      case 'job_scheduled':
        return 'Scheduled';
      case 'appointment_created':
        return 'Appointment Created';
      case 'appointment_completed':
        return 'Appointment Completed';
      case 'appointment_deleted':
        return 'Appointment Deleted';
      case 'task_created':
        return 'Task Created';
      case 'task_deleted':
        return 'Task Deleted';
      case 'project_created':
        return 'Project Created';
      case 'project_updated':
        return 'Project Updated';
      case 'project_deleted':
        return 'Project Deleted';
      case 'task_completed':
        return 'Task Completed';
      case 'project_note_added':
        return 'Project Note Added';
      case 'payroll_printed':
        return 'Payroll Printed';
      default:
        return activity.type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Activity';
    }
  };

  const getActivityDescription = (activity) => {
    if (activity.note) {
      return activity.note;
    }
    if (activity.type === 'job_updated' && activity.changes) {
      const entries = Object.entries(activity.changes);
      if (entries.length > 0) {
        const [field, change] = entries[0];
        const fromVal = change?.from ?? 'empty';
        const toVal = change?.to ?? 'empty';
        const more = entries.length > 1 ? ` (+${entries.length - 1} more)` : '';
        return `${field}: ${fromVal} → ${toVal}${more}`;
      }
    }
    if (activity.jobId?.title) {
      return activity.jobId.title;
    }
    if (activity.taskId?.title) {
      return activity.taskId.title;
    }
    if (activity.customerId?.name) {
      return activity.customerId.name;
    }
    if (activity.fileName) {
      return activity.fileName;
    }
    return '';
  };

  const formatMarkedPaidAt = (dateString) => {
    if (!dateString) return '';
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
      return `${format(date, 'MMM d, yyyy')} · ${format(date, 'h:mm a')}`;
    } catch (error) {
      return '';
    }
  };

  const formatPaymentPaidDate = (dateString) => {
    if (!dateString) return '—';
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
      return format(date, 'MMM d, yyyy');
    } catch (error) {
      return '—';
    }
  };

  const recentMarkedPaidPayments = useMemo(
    () => markedPaidPayments.slice(0, 25),
    [markedPaidPayments],
  );

  const markedPaidTotal = useMemo(
    () =>
      recentMarkedPaidPayments.reduce((sum, activity) => sum + (Number(activity.amount) || 0), 0),
    [recentMarkedPaidPayments],
  );

  const unsentPaymentAlertCount = useMemo(
    () => markedPaidPayments.filter((activity) => !activity.paymentNotificationSentAt).length,
    [markedPaidPayments],
  );

  const handleSendUnsentPaymentAlerts = async () => {
    if (unsentPaymentAlertCount === 0) return;
    try {
      setSendingUnsentPaymentAlerts(true);
      let totalSent = 0;
      let totalSms = 0;
      let lastError = null;

      for (let round = 0; round < 10; round += 1) {
        const result = await sendUnsentPaymentNotifications();
        if (result.error) {
          lastError = result.error;
          break;
        }
        if (!result.total) break;
        totalSent += result.sentActivities || 0;
        totalSms += result.smsCount || 0;
        if ((result.sentActivities || 0) === 0) break;
      }

      await fetchDashboardData();

      if (totalSent > 0) {
        toast.success(
          `Sent ${totalSent} payment alert${totalSent === 1 ? '' : 's'} (${totalSms} text${totalSms === 1 ? '' : 's'})`,
        );
      } else if (lastError) {
        toast.error(lastError);
      } else {
        toast.error('Could not send payment alerts — check Twilio and alert settings.');
      }
    } catch (error) {
      console.error('Failed to send unsent payment alerts:', error);
      toast.error(error.response?.data?.error || 'Failed to send payment alerts');
    } finally {
      setSendingUnsentPaymentAlerts(false);
    }
  };

  const resolvePaymentScheduleLabel = (activity) => {
    const label = activity?.paymentLabel || parsePaymentReceivedLabel(activity);
    return String(label).split(':')[0]?.trim() || '';
  };

  const handlePaymentContextMenu = (event, activity) => {
    if (!canEditPaymentAlerts) return;
    event.preventDefault();
    event.stopPropagation();
    setPaymentContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
    });
    setPaymentContextActivity(activity);
  };

  const handleClosePaymentContextMenu = () => {
    setPaymentContextMenu(null);
    setPaymentContextActivity(null);
  };

  const handleSendPaymentAlertToGroup = async (force = false) => {
    const activity = paymentContextActivity;
    handleClosePaymentContextMenu();
    if (!activity) return;

    const alertKey = String(activity._id || `${activity.jobId?._id || activity.jobId}-${resolvePaymentScheduleLabel(activity)}`);
    const jobId = activity.jobId?._id || activity.jobId;
    const scheduleLabel = resolvePaymentScheduleLabel(activity);
    const activityId = activity.synthetic ? undefined : activity._id;

    try {
      setSendingPaymentAlertKey(alertKey);
      const result = await sendManualPaymentNotification({
        activityId,
        jobId,
        scheduleLabel,
        force,
      });

      await fetchDashboardData();

      if (result.alreadySent && !force) {
        toast(result.message || 'Alert already sent for this payment.');
        return;
      }
      if ((result.sentCount || 0) > 0) {
        toast.success(
          `Sent alert to group (${result.sentCount} text${result.sentCount === 1 ? '' : 's'})`,
        );
        return;
      }
      toast.error(result.error || 'Could not send payment alert.');
    } catch (error) {
      console.error('Failed to send payment alert:', error);
      toast.error(error.response?.data?.error || 'Failed to send payment alert');
    } finally {
      setSendingPaymentAlertKey(null);
    }
  };

  const formatActivityTime = (dateString) => {
    if (!dateString) return '';
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) {
      return '';
    }
  };

  const handleDeleteClick = (activity) => {
    setActivityToDelete(activity);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!activityToDelete) return;

    try {
      setDeleting(true);
      await axios.delete(`${API_URL}/activities/${activityToDelete._id}`);
      toast.success('Activity deleted successfully');
      
      // Remove the activity from the list
      setActivities(activities.filter(a => a._id !== activityToDelete._id));
      setMarkedPaidPayments((prev) => prev.filter((a) => a._id !== activityToDelete._id));
      
      setDeleteConfirmOpen(false);
      setActivityToDelete(null);
    } catch (error) {
      console.error('Error deleting activity:', error);
      toast.error(error.response?.data?.error || 'Failed to delete activity');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmOpen(false);
    setActivityToDelete(null);
  };

  // Get color for activity type
  const getActivityTypeColor = (type) => {
    const colorMap = {
      // Job-related
      'job_created': 'success',
      'job_updated': 'info',
      'job_archived': 'default',
      'stage_change': 'primary',
      'job_scheduled': 'primary',
      'takeoff_complete': 'success',
      'value_update': 'warning',
      // Files
      'file_uploaded': 'success',
      'file_deleted': 'error',
      // Notes
      'note': 'info',
      'project_note_added': 'info',
      // Appointments
      'meeting': 'primary',
      'appointment_created': 'success',
      'appointment_completed': 'success',
      'appointment_deleted': 'error',
      // Tasks/Projects
      'task_created': 'success',
      'task_deleted': 'error',
      'project_created': 'success',
      'project_updated': 'info',
      'project_deleted': 'error',
      'task_completed': 'success',
      // Payroll
      'payroll_printed': 'info',
      // Other
      'customer_created': 'success',
      'customer_updated': 'info',
      'estimate_sent': 'warning',
      'estimate_updated': 'warning',
      'contract_signed': 'success',
      'deposit_received': 'success',
      'payment_schedule_updated': 'info',
      'payment_received': 'success',
      'calendar_sync': 'info',
      // Developer tasks
      'developer_task_created': 'info',
      'developer_task_updated': 'info',
      'developer_task_completed': 'success',
      'developer_task_deleted': 'error',
    };
    return colorMap[type] || 'default';
  };

  // Sort all activities by most recent (they should already be sorted, but ensure it)
  const sortedActivities = [...activities].sort((a, b) => {
    const dateA = new Date(a.createdAt);
    const dateB = new Date(b.createdAt);
    return dateB - dateA; // Most recent first
  });

  const openSummarySetup = () => {
    setSummarySetupDialogOpen(true);
  };

  const resetSummaryDatesToLast7Days = () => {
    setSummaryStartDate(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
    setSummaryEndDate(format(new Date(), 'yyyy-MM-dd'));
  };

  const runActivitySummary = useCallback(async (payload) => {
    setSummaryLoading(true);
    setSummaryText('');
    setSummaryActivityCount(null);
    setSummaryTotalInRange(null);
    setSummaryNewestAt(null);
    setSummaryGeneratedAt(null);
    setSummaryTruncated(false);
    setSummaryResultDialogOpen(true);
    try {
      const res = await axios.post(`${API_URL}/activities/summary`, payload);
      setSummaryText(res.data.summary || '');
      setSummaryActivityCount(typeof res.data.activityCount === 'number' ? res.data.activityCount : null);
      setSummaryTotalInRange(
        typeof res.data.totalInRange === 'number' ? res.data.totalInRange : null
      );
      setSummaryNewestAt(res.data.newestActivityAt || null);
      setSummaryGeneratedAt(res.data.generatedAt || null);
      setSummaryTruncated(Boolean(res.data.truncated));
      setSummaryLastRequest({
        startDate: payload.startDate,
        endDate: payload.endDate,
        prompt: payload.prompt || '',
      });
    } catch (error) {
      setSummaryResultDialogOpen(false);
      const msg =
        error.response?.data?.error ||
        (typeof error.response?.data === 'string' ? error.response.data : null) ||
        error.message;
      const code = error.response?.data?.code;
      console.error('Activity summary error:', error.response?.status, error.response?.data);
      toast.error(
        [msg, code ? `(${code})` : null, error.response?.status ? `[HTTP ${error.response.status}]` : null]
          .filter(Boolean)
          .join(' ')
      );
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const handleConfirmSummaryRequest = async () => {
    if (!summaryStartDate || !summaryEndDate) {
      toast.error('Choose a start and end date');
      return;
    }
    if (summaryStartDate > summaryEndDate) {
      toast.error('Start date must be on or before end date');
      return;
    }
    setSummarySetupDialogOpen(false);
    const payload = { startDate: summaryStartDate, endDate: summaryEndDate };
    const trimmed = summaryUserPrompt.trim();
    if (trimmed) {
      payload.prompt = trimmed;
    }
    await runActivitySummary(payload);
  };

  const handleRefreshActivitySummary = async () => {
    if (!summaryLastRequest) {
      return;
    }
    const p = { startDate: summaryLastRequest.startDate, endDate: summaryLastRequest.endDate };
    if (summaryLastRequest.prompt) {
      p.prompt = summaryLastRequest.prompt;
    }
    await runActivitySummary(p);
  };

  // Handle print
  const handlePrint = () => {
    setPrintDialogOpen(false);
    const reportLogoSrc = `${window.location.origin}${APP_LOGO_LIGHT}`;

    // Filter activities for selected date (handle timezone correctly)
    // Parse the date string and create date in local timezone
    const [year, month, day] = selectedPrintDate.split('-').map(Number);
    const selectedDateObj = new Date(year, month - 1, day, 0, 0, 0, 0); // Local timezone
    const nextDay = new Date(year, month - 1, day + 1, 0, 0, 0, 0); // Next day in local timezone
    
    const filteredActivities = sortedActivities.filter((activity) => {
      const activityDate = new Date(activity.createdAt);
      // Normalize activity date to local date (ignore time)
      const activityDateLocal = new Date(activityDate.getFullYear(), activityDate.getMonth(), activityDate.getDate());
      const selectedDateLocal = new Date(selectedDateObj.getFullYear(), selectedDateObj.getMonth(), selectedDateObj.getDate());
      return activityDateLocal.getTime() === selectedDateLocal.getTime();
    });

    // Group activities by type for summary
    const activityCounts = {};
    filteredActivities.forEach((activity) => {
      const type = activity.type || 'other';
      activityCounts[type] = (activityCounts[type] || 0) + 1;
    });

    // Group activities by customer
    const activitiesByCustomer = {};
    filteredActivities.forEach((activity) => {
      const customerName = activity.customerId?.name || '';
      if (!activitiesByCustomer[customerName]) {
        activitiesByCustomer[customerName] = [];
      }
      activitiesByCustomer[customerName].push(activity);
    });

    const getActivityTitle = (type) => {
      const titles = {
        'stage_change': 'Stage Change',
        'note': 'Note',
        'job_created': 'Job Created',
        'job_updated': 'Job Updated',
        'job_archived': 'Job Archived',
        'file_uploaded': 'File Uploaded',
        'file_deleted': 'File Deleted',
        'meeting': 'Scheduled',
        'job_scheduled': 'Scheduled',
        'appointment_created': 'Appointment Created',
        'appointment_completed': 'Appointment Completed',
        'appointment_deleted': 'Appointment Deleted',
        'task_created': 'Task Created',
        'task_deleted': 'Task Deleted',
        'project_created': 'Project Created',
        'project_updated': 'Project Updated',
        'project_deleted': 'Project Deleted',
        'task_completed': 'Task Completed',
        'project_note_added': 'Project Note Added',
        'payroll_printed': 'Payroll Printed',
        'developer_task_created': 'Developer Task',
        'developer_task_updated': 'Developer Task',
        'developer_task_completed': 'Developer Task Completed',
        'developer_task_deleted': 'Developer Task Deleted',
      };
      return titles[type] || type?.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) || 'Activity';
    };

    const getActivityDescription = (activity) => {
      if (activity.note) return activity.note;
      if (activity.jobId?.title) return activity.jobId.title;
      if (activity.taskId?.title) return activity.taskId.title;
      if (activity.customerId?.name) return activity.customerId.name;
      if (activity.fileName) return activity.fileName;
      return '';
    };

    const formatDate = (dateString) => {
      if (!dateString) return '';
      try {
        const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
        return format(date, 'MMM dd, yyyy h:mm a');
      } catch (error) {
        return '';
      }
    };

    // Generate summary HTML
    const summaryHTML = Object.entries(activityCounts).map(([type, count]) => `
      <div class="summary-item">
        <div class="summary-item-label">${getActivityTitle(type)}</div>
        <div class="summary-item-value">${count}</div>
      </div>
    `).join('');

    // Sort all filtered activities by most recent first (same as recent activity feed)
    const sortedFilteredActivities = [...filteredActivities].sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB - dateA; // Most recent first
    });

    // Generate activities HTML - maintain chronological order, group consecutive activities by customer
    let currentCustomer = null;
    let activitiesHTML = '';
    
    sortedFilteredActivities.forEach((activity, index) => {
      const customerName = activity.customerId?.name || '';
      const isNewCustomer = customerName !== currentCustomer;
      
      // If new customer, close previous section and start new one
      if (isNewCustomer) {
        if (currentCustomer !== null) {
          activitiesHTML += '</div>'; // Close previous customer section
        }
        // Only show customer name header if there is a customer name
        if (customerName) {
          activitiesHTML += `
            <div class="customer-section">
              <div class="customer-name">${customerName}</div>
          `;
        } else {
          activitiesHTML += `
            <div class="customer-section">
          `;
        }
        currentCustomer = customerName;
      }
      
      const title = getActivityTitle(activity.type);
      const description = getActivityDescription(activity);
      const jobLabel = activity.jobId?.title || '';
      const taskLabel = activity.taskId?.title || '';
      const userName = activity.createdBy?.name || '';
      
      activitiesHTML += `
        <div class="activity-item">
          <div class="activity-header">
            <div class="activity-title">${title}</div>
            <div class="activity-time">${formatDate(activity.createdAt)}</div>
          </div>
          ${description ? `<div class="activity-description">${description}</div>` : ''}
          ${(jobLabel || taskLabel) ? `<div class="activity-meta">${jobLabel ? `Job: ${jobLabel}` : ''}${jobLabel && taskLabel ? ' | ' : ''}${taskLabel ? `${activity.taskId?.isProject ? 'Project' : 'Task'}: ${taskLabel}` : ''}</div>` : ''}
          ${userName ? `<div class="activity-user">by ${userName}</div>` : ''}
        </div>
      `;
    });
    
    // Close last customer section
    if (currentCustomer !== null) {
      activitiesHTML += '</div>';
    }

    // Wait a moment for dialog to close, then trigger print
    setTimeout(() => {
      const printWindow = window.open('', '_blank');
      
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Activity Report - ${format(selectedDateObj, 'MMMM dd, yyyy')}</title>
            <style>
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                }
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                  font-size: 12pt;
                  line-height: 1.5;
                  color: #000;
                  padding: 20px;
                }
                img {
                  max-width: 100%;
                  height: auto;
                }
                .header {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  margin-bottom: 20px;
                  padding-bottom: 15px;
                  border-bottom: 2px solid #000;
                }
                .logo-container {
                  display: flex;
                  align-items: center;
                  gap: 15px;
                }
                .logo-container img {
                  height: 60px;
                }
                .summary {
                  margin-bottom: 20px;
                }
                .summary-title {
                  font-size: 14pt;
                  font-weight: 600;
                  margin-bottom: 10px;
                }
                .summary-grid {
                  display: grid;
                  grid-template-columns: repeat(4, 1fr);
                  gap: 10px;
                  margin-bottom: 15px;
                }
                .summary-item {
                  border: 2px solid #000;
                  border-radius: 4px;
                  padding: 10px;
                  text-align: center;
                }
                .summary-item-label {
                  font-size: 10pt;
                  color: #666;
                  margin-bottom: 5px;
                }
                .summary-item-value {
                  font-size: 16pt;
                  font-weight: 600;
                }
                .activities-section {
                  margin-top: 20px;
                }
                .activities-title {
                  font-size: 14pt;
                  font-weight: 600;
                  margin-bottom: 15px;
                }
                .customer-section {
                  margin-bottom: 20px;
                  padding-bottom: 15px;
                  border-bottom: 2px solid #000;
                }
                .customer-section:last-child {
                  border-bottom: none;
                }
                .customer-name {
                  font-weight: 700;
                  font-size: 12pt;
                  margin-bottom: 10px;
                }
                .activity-item {
                  margin-bottom: 10px;
                  padding-left: 15px;
                  border-left: 1px solid #ccc;
                }
                .activity-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: flex-start;
                  margin-bottom: 5px;
                }
                .activity-title {
                  font-weight: 600;
                  font-size: 11pt;
                }
                .activity-time {
                  font-size: 9pt;
                  color: #666;
                }
                .activity-description {
                  font-size: 10pt;
                  margin-bottom: 5px;
                }
                .activity-meta {
                  font-size: 9pt;
                  color: #666;
                  font-family: monospace;
                }
                .activity-user {
                  font-size: 9pt;
                  color: #666;
                  margin-top: 3px;
                }
                @media print {
                  body {
                    padding: 15px;
                  }
                  .header {
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                  }
                  .summary {
                    margin-bottom: 15px;
                  }
                  .customer-section {
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                  }
                  .activity-item {
                    margin-bottom: 8px;
                  }
                }
              </style>
            </head>
            <body>
              <div class="header">
                <div class="logo-container">
                  <img src="${reportLogoSrc}" alt="Logo" />
                  <div>
                    <h1>Activity Report</h1>
                    <p>${format(selectedDateObj, 'EEEE, MMMM dd, yyyy')}</p>
                  </div>
                </div>
              </div>
              
              <div class="summary">
                <div class="summary-title">Summary</div>
                <div class="summary-grid">
                  ${summaryHTML}
                  <div class="summary-item">
                    <div class="summary-item-label">Total Activities</div>
                    <div class="summary-item-value">${filteredActivities.length}</div>
                  </div>
                </div>
              </div>
              
              <div class="activities-section">
                <div class="activities-title">Activities by Customer</div>
                ${activitiesHTML}
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
          printWindow.close();
        }, 250);
    }, 100);
  };

  const todayLabel = format(new Date(), 'EEEE, MMMM d');

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: '100%', minWidth: 0, py: { xs: 2, sm: 3 } }}>
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
        }}
      >
        <KioskViewNav currentView="dashboard" />
        <Typography variant="body2" color="text.secondary">
          {todayLabel}
        </Typography>
      </Box>

      <DashboardInsightGrid
        hideSensitive={hideSensitive}
        showTraffic={Boolean(isSuperAdmin())}
        payments={markedPaidPayments}
        activities={chartActivities}
        traffic={trafficSeries}
        teamActivity={teamActivity}
        pipeline={stats.pipelineMix}
        canOpenFinance={canOpenFinanceHub}
      />

      {/* Quick stats strip */}
      <Grid container spacing={2} sx={{ mb: 3, alignItems: 'stretch' }}>
        <Grid item xs={6} md={3} sx={{ display: 'flex' }}>
          <DashboardQuickTile
            label="Customers"
            value={stats.totalCustomers}
            icon={PeopleIcon}
            accentColor={theme.palette.primary.main}
            onClick={() => navigate('/customers')}
            theme={theme}
          />
        </Grid>
        <Grid item xs={6} md={3} sx={{ display: 'flex' }}>
          <DashboardQuickTile
            label="Upcoming"
            value={stats.upcomingAppointments.length}
            icon={CalendarIcon}
            accentColor={theme.palette.primary.main}
            onClick={() => navigate('/calendar')}
            theme={theme}
          />
        </Grid>
        <Grid item xs={6} md={3} sx={{ display: 'flex' }}>
          <DashboardQuickTile
            label="Pending tasks"
            value={stats.pendingTasks.length}
            icon={TasksIcon}
            accentColor={theme.palette.primary.main}
            onClick={() => navigate('/tasks')}
            theme={theme}
          />
        </Grid>
        <Grid item xs={6} md={3} sx={{ display: 'flex' }}>
          <DashboardQuickTile
            label="Urgent"
            value={stats.urgentTasks.length}
            icon={WarningIcon}
            accentColor={stats.urgentTasks.length > 0 ? theme.palette.error.main : theme.palette.text.secondary}
            onClick={() => navigate('/tasks')}
            alert={stats.urgentTasks.length > 0}
            theme={theme}
          />
        </Grid>
      </Grid>

      {/* Main panels */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
          <Paper elevation={0} sx={{ ...dashboardPanelSx(theme), width: '100%' }}>
            <DashboardPanelHeader title="Pending tasks" actionLabel="View all" onAction={() => navigate('/tasks')} />
            {stats.pendingTasks.length === 0 ? (
              <DashboardEmptyState message="You're caught up — no pending tasks." />
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {stats.pendingTasks.map((task) => (
                  <Box
                    key={task._id}
                    onClick={() => navigate('/tasks')}
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>
                      {task.title}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                      {task.dueDate && (
                        <Typography variant="caption" color="text.secondary">
                          Due {formatDate(task.dueDate)}
                        </Typography>
                      )}
                      {task.assignedTo?.name && (
                        <Typography variant="caption" color="text.secondary">
                          {task.assignedTo.name}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
          <Paper elevation={0} sx={{ ...dashboardPanelSx(theme), width: '100%' }}>
            <DashboardPanelHeader title="Upcoming appointments" actionLabel="Calendar" onAction={() => navigate('/calendar')} />
            {stats.upcomingAppointments.length === 0 ? (
              <DashboardEmptyState message="Nothing scheduled ahead — check the calendar to book time." />
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {stats.upcomingAppointments.map((apt) => (
                  <Box
                    key={apt._id}
                    onClick={() => navigate('/calendar')}
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1.5,
                      p: 1.5,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 2,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                      }}
                    >
                      <ScheduleIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {apt.jobId?.title || apt.customerId?.name || apt.title || 'Appointment'}
                        </Typography>
                        <Chip
                          label={`${formatDate(apt.date)}${apt.time ? ` · ${apt.time}` : ''}`}
                          size="small"
                          variant="outlined"
                          sx={{ height: 22, fontSize: '0.7rem' }}
                        />
                      </Box>
                      {(apt.customerId?.name || apt.location) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                          {[apt.customerId?.name, apt.location].filter(Boolean).join(' · ')}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Payments marked paid — ordered by when PAID was clicked */}
      <Paper elevation={0} sx={{ ...dashboardPanelSx(theme), mb: 3 }}>
        <DashboardPanelHeader
          title="Deposits & payments marked paid"
          subtitle="Marked paid = when you clicked Paid · Paid date = date entered on the payment schedule"
          actionLabel={undefined}
          onAction={undefined}
          headerActions={<PaymentNotificationSettings canEdit={canEditPaymentAlerts} dialogTrigger />}
        />
        {recentMarkedPaidPayments.length === 0 ? (
          <DashboardEmptyState message="No payments marked paid yet — use Paid on a job payment schedule to log them here." />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {recentMarkedPaidPayments.length} recent
                {hideSensitive ? '' : ` · ${formatCurrency(markedPaidTotal)} shown`}
                {unsentPaymentAlertCount > 0
                  ? ` · ${unsentPaymentAlertCount} unsent alert${unsentPaymentAlertCount === 1 ? '' : 's'}`
                  : ''}
              </Typography>
              {canEditPaymentAlerts && unsentPaymentAlertCount > 0 ? (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={
                    sendingUnsentPaymentAlerts ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <SmsIcon fontSize="small" />
                    )
                  }
                  onClick={handleSendUnsentPaymentAlerts}
                  disabled={sendingUnsentPaymentAlerts}
                  sx={{ textTransform: 'none', borderRadius: 2, flexShrink: 0 }}
                >
                  {sendingUnsentPaymentAlerts
                    ? 'Sending…'
                    : `Send ${unsentPaymentAlertCount} unsent`}
                </Button>
              ) : null}
            </Box>
            <Box sx={{ ...dashboardScrollListSx, maxHeight: 460 }}>
            {recentMarkedPaidPayments.map((activity, idx) => {
              const jobId = activity.jobId?._id || activity.jobId;
              const jobLabel = activity.jobId?.title || '';
              const customerLabel = activity.customerId?.name || '';
              const paymentLabel = activity.paymentLabel || parsePaymentReceivedLabel(activity);
              const isJobFullyPaid =
                activity.jobBalanceDue !== null && activity.jobBalanceDue !== undefined
                  && activity.jobBalanceDue <= 0.01;

              return (
                <Box
                  key={activity._id || idx}
                  onClick={() => {
                    if (jobId) navigate(`/pipeline?jobId=${jobId}`);
                  }}
                  onContextMenu={(event) => handlePaymentContextMenu(event, activity)}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    p: 1.5,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: isJobFullyPaid ? 'success.main' : 'divider',
                    cursor: jobId ? 'pointer' : 'default',
                    bgcolor: isJobFullyPaid
                      ? alpha(
                          theme.palette.success.main,
                          theme.palette.mode === 'dark' ? 0.12 : 0.06,
                        )
                      : 'transparent',
                    '&:hover': jobId ? { bgcolor: isJobFullyPaid ? alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.18 : 0.1) : 'action.hover' } : undefined,
                  }}
                >
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 2,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alpha(theme.palette.success.main, 0.12),
                    }}
                  >
                    <MoneyIcon sx={{ fontSize: 20, color: 'success.main' }} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {hideSensitive ? 'Locked' : formatCurrency(activity.amount || 0)}
                      </Typography>
                      <Chip
                        label={paymentLabel}
                        size="small"
                        color="success"
                        variant="outlined"
                        sx={{ height: 22, fontSize: '0.7rem', maxWidth: '100%' }}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.35 }}>
                      <Typography variant="caption" color="text.secondary">
                        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                          Marked paid
                        </Box>
                        {' '}
                        {formatMarkedPaidAt(activity.createdAt)}
                        {activity.createdBy?.name ? ` · ${activity.createdBy.name}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                          Paid date
                        </Box>
                        {' '}
                        {formatPaymentPaidDate(activity.resolvedPaymentPaidAt || activity.paymentPaidAt)}
                      </Typography>
                    </Box>
                    {(jobLabel || customerLabel) && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                        {[customerLabel, jobLabel].filter(Boolean).join(' · ')}
                      </Typography>
                    )}
                  </Box>
                  {activity.paymentNotificationSentAt ? (
                    <Chip
                      label="Text sent"
                      size="small"
                      color="info"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        flexShrink: 0,
                        alignSelf: 'flex-start',
                        mt: 0.15,
                      }}
                    />
                  ) : null}
                </Box>
              );
            })}
            </Box>
          </Box>
        )}
        {canEditPaymentAlerts ? (
          <Menu
            open={paymentContextMenu !== null}
            onClose={handleClosePaymentContextMenu}
            anchorReference="anchorPosition"
            anchorPosition={
              paymentContextMenu !== null
                ? { top: paymentContextMenu.mouseY, left: paymentContextMenu.mouseX }
                : undefined
            }
          >
            {paymentContextActivity?.paymentNotificationSentAt ? (
              <MenuItem
                onClick={() => handleSendPaymentAlertToGroup(true)}
                disabled={Boolean(sendingPaymentAlertKey)}
              >
                <ListItemIcon>
                  <SmsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Resend alert to group"
                  secondary="Text the payment alert group again"
                />
              </MenuItem>
            ) : (
              <MenuItem
                onClick={() => handleSendPaymentAlertToGroup(false)}
                disabled={Boolean(sendingPaymentAlertKey)}
              >
                <ListItemIcon>
                  <SmsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Send alert to group"
                  secondary="Text everyone in the payment alert group"
                />
              </MenuItem>
            )}
          </Menu>
        ) : null}
      </Paper>

      {/* Recent Activity */}
      <Paper elevation={0} sx={dashboardPanelSx(theme)}>
        <DashboardPanelHeader
          title="Recent activity"
          subtitle="Log work, generate summaries, or print a daily report"
          headerActions={
            <>
              <Tooltip
                title={AI_SUMMARY_HOVER_JOKE}
                enterDelay={250}
                placement="top"
                slotProps={{ tooltip: { sx: { maxWidth: 340 } } }}
              >
                <span>
                  <Button
                    variant="contained"
                    color="secondary"
                    size="small"
                    startIcon={<AutoAwesomeIcon />}
                    onClick={openSummarySetup}
                    sx={{ textTransform: 'none', borderRadius: 2 }}
                  >
                    AI summary
                  </Button>
                </span>
              </Tooltip>
              <Button
                variant="outlined"
                size="small"
                startIcon={<PrintIcon />}
                onClick={() => setPrintDialogOpen(true)}
                sx={{ textTransform: 'none', borderRadius: 2 }}
              >
                Print activity
              </Button>
            </>
          }
        />

        <Box
          component="form"
          onSubmit={handleManualActivitySubmit}
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            mb: 2,
            alignItems: 'center',
            p: 2,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.06 : 0.03),
          }}
        >
              <TextField
                label="Time"
                type="time"
                size="small"
                value={manualActivityTime}
                onChange={(e) => setManualActivityTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 140 }}
              />
              <TextField
                label="Quick activity note"
                placeholder='e.g. "8:30 worked on Wells Fargo stuff (job – no name)"'
                size="small"
                value={manualActivityNote}
                onChange={(e) => setManualActivityNote(e.target.value)}
                sx={{ flexGrow: 1, minWidth: 220 }}
              />
              <Button
                type="submit"
                variant="contained"
                size="small"
                disabled={savingManualActivity}
                sx={{ textTransform: 'none' }}
              >
                Add to Activity
              </Button>
        </Box>

        {sortedActivities.length === 0 ? (
          <DashboardEmptyState message="No activity logged yet — add a quick note above to get started." />
        ) : (
          <Box sx={{ ...dashboardScrollListSx, maxHeight: 560 }}>
            {sortedActivities.slice(0, 50).map((activity, idx) => {
              const title = getActivityTitle(activity);
              const description = getActivityDescription(activity);
              const timeShort = formatActivityTime(activity.createdAt);
              const jobLabel = activity.jobId?.title || '';
              const taskLabel = activity.taskId?.title || '';
              const customerLabel = activity.customerId?.name || '';
              const userName = activity.createdBy?.name || '';
              const typeColor = getActivityTypeColor(activity.type);

              return (
                <Box
                  key={activity._id || idx}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: idx === 0 ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.06 : 0.03) : 'transparent',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: description ? 0.5 : 0 }}>
                        <Chip
                          label={title}
                          size="small"
                          color={typeColor}
                          sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {timeShort}
                        </Typography>
                        {userName && (
                          <Typography variant="caption" color="text.secondary">
                            · {userName}
                          </Typography>
                        )}
                      </Box>
                      {description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                          {description}
                        </Typography>
                      )}
                      {(jobLabel || taskLabel || customerLabel) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {jobLabel && (
                            <Box
                              component="span"
                              onClick={() => {
                                const jobId = activity.jobId?._id || activity.jobId;
                                if (jobId) {
                                  navigate(`/pipeline?jobId=${jobId}`);
                                }
                              }}
                              sx={{
                                color: 'primary.main',
                                cursor: 'pointer',
                                fontWeight: 500,
                                '&:hover': { textDecoration: 'underline' },
                              }}
                            >
                              {jobLabel}
                            </Box>
                          )}
                          {taskLabel && `${jobLabel ? ' · ' : ''}${taskLabel}`}
                          {(jobLabel || taskLabel) && customerLabel && ' · '}
                          {customerLabel}
                        </Typography>
                      )}
                    </Box>
                    <IconButton
                      size="small"
                      onClick={() => handleDeleteClick(activity)}
                      sx={{
                        opacity: 0.45,
                        flexShrink: 0,
                        '&:hover': { opacity: 1, color: 'error.main' },
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={handleDeleteCancel}>
        <DialogTitle>Delete Activity?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this activity? This action cannot be undone.
          </Typography>
          {activityToDelete && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {getActivityTitle(activityToDelete)}
              </Typography>
              {getActivityDescription(activityToDelete) && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {getActivityDescription(activityToDelete)}
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button 
            onClick={handleDeleteConfirm} 
            color="error" 
            variant="contained"
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI summary — choose dates and optional focus */}
      <Dialog
        open={summarySetupDialogOpen}
        onClose={() => setSummarySetupDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirmSummaryRequest();
          }}
        >
          <DialogTitle>AI activity summary</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              The summary is built from the activity timeline in this range (logged events, notes, stage
              changes, and similar). Edits that do not add a row to the activity feed will not appear here.
            </Typography>
            <Button
              type="button"
              size="small"
              onClick={resetSummaryDatesToLast7Days}
              sx={{ textTransform: 'none', mb: 2, p: 0, minWidth: 0 }}
            >
              Use last 7 days
            </Button>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
              <TextField
                label="From"
                type="date"
                size="small"
                value={summaryStartDate}
                onChange={(e) => setSummaryStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ flex: '1 1 140px', minWidth: 140 }}
              />
              <TextField
                label="To"
                type="date"
                size="small"
                value={summaryEndDate}
                onChange={(e) => setSummaryEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ flex: '1 1 140px', minWidth: 140 }}
              />
            </Box>
            <TextField
              label="Optional focus (leave blank for a general summary)"
              placeholder='e.g. "Prioritize installs and overdue tasks"'
              value={summaryUserPrompt}
              onChange={(e) => setSummaryUserPrompt(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              inputProps={{ maxLength: 1500 }}
              helperText={`${summaryUserPrompt.length}/1500`}
            />
          </DialogContent>
          <DialogActions>
            <Button type="button" onClick={() => setSummarySetupDialogOpen(false)}>
              Cancel
            </Button>
            <Tooltip
              title={AI_SUMMARY_HOVER_JOKE}
              enterDelay={250}
              placement="left"
              slotProps={{ tooltip: { sx: { maxWidth: 340 } } }}
            >
              <span>
                <Button type="submit" variant="contained" color="secondary" startIcon={<AutoAwesomeIcon />}>
                  Generate summary
                </Button>
              </span>
            </Tooltip>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={summaryResultDialogOpen}
        onClose={() => {
          if (!summaryLoading) setSummaryResultDialogOpen(false);
        }}
        maxWidth="md"
        fullWidth
      >
        {summaryLoading && (
          <LinearProgress
            sx={{
              position: 'sticky',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 1,
            }}
          />
        )}
        <DialogTitle>AI activity summary</DialogTitle>
        <DialogContent>
          {summaryLoading && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Generating summary… this can take a few seconds.
            </Typography>
          )}
          {!summaryLoading && (summaryActivityCount !== null || summaryTotalInRange !== null || summaryTruncated) && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {summaryTotalInRange != null && (
                  <>
                    {summaryTotalInRange} event{summaryTotalInRange === 1 ? '' : 's'} in this range in the database
                    {summaryTotalInRange > 500
                      ? ` (AI uses the 500 most recent: ${summaryActivityCount ?? 500} loaded)`
                      : null}
                  </>
                )}
                {summaryTotalInRange == null && summaryActivityCount != null && (
                  <>
                    {summaryActivityCount} event{summaryActivityCount === 1 ? '' : 's'} sent to the model
                    {summaryTruncated ? ' (capped at 500)' : null}
                  </>
                )}
                {summaryNewestAt && (
                  <span>
                    {(summaryTotalInRange != null || summaryActivityCount != null) ? ' · ' : null}Newest included:{' '}
                    {format(parseISO(summaryNewestAt), 'PPp')}
                  </span>
                )}
              </Typography>
              {summaryGeneratedAt && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                  Generated: {format(parseISO(summaryGeneratedAt), 'PPp')}
                  {summaryLastRequest
                    ? ` — refresh re-runs from the server (no cache). If something is still missing, add a timeline entry or check the date range.`
                    : null}
                </Typography>
              )}
            </Box>
          )}
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              p: 1.5,
              bgcolor: 'background.default',
              maxHeight: '60vh',
              overflowY: 'auto',
              opacity: summaryLoading ? 0.65 : 1,
            }}
          >
            {summaryLoading ? (
              <Typography variant="body2" color="text.secondary">
                Working…
              </Typography>
            ) : (
              renderSummaryBlocks(summaryText)
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleRefreshActivitySummary}
            disabled={!summaryLastRequest || summaryLoading}
            sx={{ textTransform: 'none' }}
          >
            Refresh summary
          </Button>
          <Button
            onClick={() => {
              if (summaryText) {
                navigator.clipboard.writeText(summaryText);
                toast.success('Copied to clipboard');
              }
            }}
            disabled={!summaryText || summaryLoading}
          >
            Copy
          </Button>
          <Button
            onClick={() => setSummaryResultDialogOpen(false)}
            variant="contained"
            disabled={summaryLoading}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={printDialogOpen} onClose={() => setPrintDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Print Activity Report</DialogTitle>
        <DialogContent>
          <TextField
            label="Select Date"
            type="date"
            value={selectedPrintDate}
            onChange={(e) => setSelectedPrintDate(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
            InputLabelProps={{
              shrink: true,
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrintDialogOpen(false)}>Cancel</Button>
          <Button onClick={handlePrint} variant="contained" startIcon={<PrintIcon />}>
            Print
          </Button>
        </DialogActions>
      </Dialog>

      {/* Print View (Hidden until print) */}
      <Box
        id="print-view"
        sx={{
          display: 'none',
          '@media print': { display: 'block' },
        }}
      >
        <PrintView activities={sortedActivities} selectedDate={selectedPrintDate} />
      </Box>
    </Box>
  );
}

// Print View Component
function PrintView({ activities, selectedDate }) {
  // Filter activities for selected date (handle timezone correctly)
  // Parse the date string and create date in local timezone
  const [year, month, day] = selectedDate.split('-').map(Number);
  const selectedDateObj = new Date(year, month - 1, day, 0, 0, 0, 0); // Local timezone

  // Filter activities for selected date
  const filteredActivities = activities.filter((activity) => {
    const activityDate = new Date(activity.createdAt);
    // Normalize activity date to local date (ignore time)
    const activityDateLocal = new Date(activityDate.getFullYear(), activityDate.getMonth(), activityDate.getDate());
    const selectedDateLocal = new Date(selectedDateObj.getFullYear(), selectedDateObj.getMonth(), selectedDateObj.getDate());
    return activityDateLocal.getTime() === selectedDateLocal.getTime();
  });

  // Group activities by type for summary
  const activityCounts = {};
  filteredActivities.forEach((activity) => {
    const type = activity.type || 'other';
    activityCounts[type] = (activityCounts[type] || 0) + 1;
  });

  // Group activities by customer
  const activitiesByCustomer = {};
  filteredActivities.forEach((activity) => {
    const customerName = activity.customerId?.name || '';
    if (!activitiesByCustomer[customerName]) {
      activitiesByCustomer[customerName] = [];
    }
    activitiesByCustomer[customerName].push(activity);
  });

  const getActivityTitle = (activity) => {
    switch (activity.type) {
      case 'stage_change':
        return 'Stage Change';
      case 'note':
        return 'Note';
      case 'job_created':
        return 'Job Created';
      case 'job_updated':
        return 'Job Updated';
      case 'job_archived':
        return 'Job Archived';
      case 'file_uploaded':
        return 'File Uploaded';
      case 'file_deleted':
        return 'File Deleted';
      case 'meeting':
      case 'job_scheduled':
        return 'Scheduled';
      case 'appointment_created':
        return 'Appointment Created';
      case 'appointment_completed':
        return 'Appointment Completed';
      case 'appointment_deleted':
        return 'Appointment Deleted';
      case 'task_created':
        return 'Task/Project Created';
      case 'task_deleted':
        return 'Task Deleted';
      case 'project_created':
        return 'Project Created';
      case 'project_updated':
        return 'Project Updated';
      case 'project_deleted':
        return 'Project Deleted';
      case 'task_completed':
        return 'Task Completed';
      case 'project_note_added':
        return 'Project Note Added';
      case 'payroll_printed':
        return 'Payroll Printed';
      case 'developer_task_created':
      case 'developer_task_updated':
        return 'Developer Task';
      case 'developer_task_completed':
        return 'Developer Task Completed';
      case 'developer_task_deleted':
        return 'Developer Task Deleted';
      default:
        return activity.type?.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) || 'Activity';
    }
  };

  const getActivityDescription = (activity) => {
    if (activity.note) {
      return activity.note;
    }
    if (activity.type === 'job_updated' && activity.changes) {
      const entries = Object.entries(activity.changes);
      if (entries.length > 0) {
        const [field, change] = entries[0];
        const fromVal = change?.from ?? 'empty';
        const toVal = change?.to ?? 'empty';
        return `${field}: ${fromVal} → ${toVal}`;
      }
    }
    if (activity.jobId?.title) {
      return activity.jobId.title;
    }
    if (activity.taskId?.title) {
      return activity.taskId.title;
    }
    if (activity.customerId?.name) {
      return activity.customerId.name;
    }
    if (activity.fileName) {
      return activity.fileName;
    }
    return '';
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
      return format(date, 'MMM dd, yyyy h:mm a');
    } catch (error) {
      return '';
    }
  };

  return (
    <Box sx={{ p: 3, '@media print': { p: 2 } }}>
      {/* Header with Logo and Date */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, '@media print': { mb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <BrandLogo
            alt="Liminnality"
            sx={{ height: 60, width: 60, objectFit: 'contain', '@media print': { height: 50, width: 50 } }}
          />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600, '@media print': { fontSize: '1.25rem' } }}>
              Activity Report
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ '@media print': { fontSize: '0.875rem' } }}>
              {format(selectedDateObj, 'EEEE, MMMM dd, yyyy')}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Summary Section */}
      <Box sx={{ mb: 3, '@media print': { mb: 2 } }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, '@media print': { fontSize: '1rem', mb: 1 } }}>
          Summary
        </Typography>
        <Box 
          sx={{ 
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 1.5,
            mb: 2,
            '@media print': { 
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 1,
              mb: 1.5
            }
          }}
        >
          {Object.entries(activityCounts).map(([type, count]) => (
            <Box
              key={type}
              sx={{
                border: '2px solid',
                borderColor: '#000',
                borderRadius: 1,
                p: 1.5,
                textAlign: 'center',
                '@media print': { 
                  p: 1,
                  border: '1.5px solid #000',
                },
              }}
            >
              <Typography 
                variant="body2" 
                sx={{ 
                  fontSize: '0.7rem',
                  fontWeight: 500,
                  mb: 0.5,
                  '@media print': { 
                    fontSize: '0.65rem',
                    mb: 0.25
                  } 
                }}
              >
                {getActivityTitle({ type })}
              </Typography>
              <Typography 
                variant="h5" 
                sx={{ 
                  fontWeight: 700,
                  '@media print': { 
                    fontSize: '1.5rem'
                  } 
                }}
              >
                {count}
              </Typography>
            </Box>
          ))}
        </Box>
        <Box
          sx={{
            border: '2px solid',
            borderColor: '#000',
            borderRadius: 1,
            p: 1.5,
            textAlign: 'center',
            display: 'inline-block',
            '@media print': {
              border: '1.5px solid #000',
              p: 1,
            },
          }}
        >
          <Typography 
            variant="body2" 
            sx={{ 
              fontSize: '0.7rem',
              fontWeight: 500,
              mb: 0.5,
              '@media print': { 
                fontSize: '0.65rem',
                mb: 0.25
              } 
            }}
          >
            Total Activities
          </Typography>
          <Typography 
            variant="h5" 
            sx={{ 
              fontWeight: 700,
              '@media print': { 
                fontSize: '1.5rem'
              } 
            }}
          >
            {filteredActivities.length}
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ mb: 3, '@media print': { mb: 2 } }} />

      {/* Activities List - Grouped by Customer */}
      <Box>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, '@media print': { fontSize: '1rem', mb: 1 } }}>
          Activities by Customer
        </Typography>
        {Object.keys(activitiesByCustomer).length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ '@media print': { fontSize: '0.875rem' } }}>
            No activities for this date
          </Typography>
        ) : (
          <Box>
            {Object.entries(activitiesByCustomer)
              .sort(([a], [b]) => {
                // Sort blank customer names to the end
                if (!a && b) return 1;
                if (a && !b) return -1;
                if (!a && !b) return 0;
                return a.localeCompare(b);
              })
              .map(([customerName, customerActivities], customerIdx) => (
                <Box
                  key={customerName || 'no-customer'}
                  sx={{
                    mb: 2,
                    pb: 2,
                    borderBottom: customerIdx < Object.keys(activitiesByCustomer).length - 1 ? '2px solid' : 'none',
                    borderColor: '#000',
                    '@media print': { 
                      mb: 1.5, 
                      pb: 1.5,
                      borderBottom: customerIdx < Object.keys(activitiesByCustomer).length - 1 ? '1.5px solid #000' : 'none',
                    },
                  }}
                >
                  {/* Customer Header - only show if there's a customer name */}
                  {customerName && (
                    <Typography 
                      variant="h6" 
                      sx={{ 
                        fontWeight: 700,
                        mb: 1.5,
                        fontSize: '1.1rem',
                        '@media print': { 
                          fontSize: '1rem',
                          mb: 1,
                          fontWeight: 600
                        } 
                      }}
                    >
                      {customerName}
                    </Typography>
                  )}
                  
                  {/* Activities for this customer */}
                  {customerActivities.map((activity, activityIdx) => {
                    const title = getActivityTitle(activity);
                    const description = getActivityDescription(activity);
                    const jobLabel = activity.jobId?.title || '';
                    const taskLabel = activity.taskId?.title || '';
                    const userName = activity.createdBy?.name || '';

                    return (
                      <Box
                        key={activity._id || activityIdx}
                        sx={{
                          mb: 1,
                          pl: 2,
                          borderLeft: '2px solid',
                          borderColor: 'divider',
                          '@media print': {
                            mb: 0.75,
                            pl: 1.5,
                            borderLeft: '1px solid #ccc',
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                          <Typography 
                            variant="body2" 
                            sx={{ 
                              fontWeight: 600,
                              '@media print': { 
                                fontSize: '0.85rem',
                                fontWeight: 500
                              } 
                            }}
                          >
                            {title}
                          </Typography>
                          <Typography 
                            variant="caption" 
                            color="text.secondary" 
                            sx={{ 
                              fontSize: '0.7rem',
                              '@media print': { 
                                fontSize: '0.65rem' 
                              } 
                            }}
                          >
                            {formatDate(activity.createdAt)}
                          </Typography>
                        </Box>
                        {description && (
                          <Typography 
                            variant="body2" 
                            sx={{ 
                              mb: 0.5,
                              fontSize: '0.875rem',
                              '@media print': { 
                                fontSize: '0.8rem',
                                mb: 0.25
                              } 
                            }}
                          >
                            {description}
                          </Typography>
                        )}
                        {(jobLabel || taskLabel) && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              display: 'block',
                              fontSize: '0.7rem',
                              fontFamily: 'monospace',
                              '@media print': {
                                fontSize: '0.65rem',
                              },
                            }}
                          >
                            {jobLabel && `Job: ${jobLabel}`}
                            {taskLabel && `${jobLabel ? ' | ' : ''}${activity.taskId?.isProject ? 'Project' : 'Task'}: ${taskLabel}`}
                          </Typography>
                        )}
                        {userName && (
                          <Typography 
                            variant="caption" 
                            color="text.secondary" 
                            sx={{ 
                              fontSize: '0.7rem',
                              '@media print': { 
                                fontSize: '0.65rem' 
                              } 
                            }}
                          >
                            by {userName}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default DashboardPage;
