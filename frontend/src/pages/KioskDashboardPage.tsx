/**
 * KioskDashboardPage — TV / shop-floor dashboard: first two graphs + job map.
 * Route: /dashboard-view
 */
import { Box, CircularProgress } from '@mui/material';
import { format, subDays } from 'date-fns';
import { useEffect, useState } from 'react';
import DashboardInsightGrid from '../components/dashboard/DashboardInsightGrid';
import { useAuth } from '../context/AuthContext';
import { useShopViewSensitive } from '../hooks/useShopViewSensitive';
import api from '../utils/axios';

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

type PipelineSlice = { label: string; value: number; color: string };
type TrafficPoint = { date: string; pageViews?: number; visitors?: number; contactSubmits?: number; adClicks?: number };
type CampaignPoint = { date: string; adClicks?: number; conversions?: number };
type TeamPoint = { date: string; logins?: number; pageViews?: number; clicks?: number };
type ActivityRow = { type?: string; createdAt?: string };

const EMPTY_MIX: PipelineSlice[] = [
  { label: 'Estimate', value: 0, color: '#f59e0b' },
  { label: 'In production', value: 0, color: '#6366f1' },
  { label: 'Installed', value: 0, color: '#10b981' },
];

export default function KioskDashboardPage() {
  const { user, isSuperAdmin } = useAuth();
  const { hideSensitive } = useShopViewSensitive(user?.role);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [traffic, setTraffic] = useState<TrafficPoint[] | null>(null);
  const [campaign, setCampaign] = useState<CampaignPoint[] | null>(null);
  const [teamActivity, setTeamActivity] = useState<TeamPoint[] | null>(null);
  const [pipeline, setPipeline] = useState(EMPTY_MIX);

  useEffect(() => {
    let cancelled = false;
    const chartStart = format(subDays(new Date(), 29), 'yyyy-MM-dd');
    const chartEnd = format(new Date(), 'yyyy-MM-dd');
    const superAdmin = user?.role === 'super_admin';

    void Promise.all([
      api.get(`/activities/date-range?startDate=${chartStart}&endDate=${chartEnd}`).catch(() => ({ data: [] })),
      api.get('/jobs').catch(() => ({ data: [] })),
      superAdmin
        ? api.get('/website/analytics/report?days=30&hideMine=1').catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
      superAdmin
        ? api.get('/audit-logs/summary?days=30').catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
    ]).then(([activitiesRes, jobsRes, trafficRes, teamRes]) => {
      if (cancelled) return;
      const jobs = jobsRes.data?.jobs || jobsRes.data || [];
      const activeJobs = (Array.isArray(jobs) ? jobs : []).filter(
        (job: { isArchived?: boolean; isDeadEstimate?: boolean }) => !job.isArchived && !job.isDeadEstimate,
      );
      const estimate = activeJobs.filter((job: { stage?: string }) => ESTIMATE_STAGES.includes(job.stage || '')).length;
      const production = activeJobs.filter((job: { stage?: string }) =>
        PRODUCTION_STAGES.includes(job.stage || ''),
      ).length;
      const installed = activeJobs.filter((job: { stage?: string }) => INSTALLED_STAGES.includes(job.stage || '')).length;
      const other = Math.max(0, activeJobs.length - estimate - production - installed);
      setActivities(Array.isArray(activitiesRes.data) ? activitiesRes.data : []);
      setTraffic(Array.isArray(trafficRes?.data?.series) ? trafficRes.data.series : null);
      setCampaign(Array.isArray(trafficRes?.data?.campaignSeries) ? trafficRes.data.campaignSeries : []);
      setTeamActivity(Array.isArray(teamRes?.data?.series) ? teamRes.data.series : null);
      setPipeline([
        { label: 'Estimate', value: estimate, color: '#f59e0b' },
        { label: 'In production', value: production, color: '#6366f1' },
        { label: 'Installed', value: installed, color: '#10b981' },
        ...(other ? [{ label: 'Other', value: other, color: '#94a3b8' }] : []),
      ]);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: '100vh',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        p: 2,
        pt: 1.5,
        minHeight: 0,
      }}
    >
      <DashboardInsightGrid
        hideSensitive={hideSensitive}
        showTraffic={Boolean(isSuperAdmin())}
        payments={[]}
        activities={activities}
        traffic={traffic}
        campaign={campaign}
        teamActivity={teamActivity}
        pipeline={pipeline}
        canOpenFinance={false}
        layout="kiosk"
      />
    </Box>
  );
}
