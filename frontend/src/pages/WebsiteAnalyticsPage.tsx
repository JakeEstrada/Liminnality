/**
 * WebsiteAnalyticsPage — Google campaign tag + first-party traffic log.
 * Route: /developer/analytics
 * Tabs: campaign | traffic  (?tab=)
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  MailOutline as MailIcon,
  Mouse as MouseIcon,
  PeopleOutline as PeopleIcon,
  Today as TodayIcon,
  Visibility as ViewsIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useSocketConnectionStatus, useSocketSubscription } from '../hooks/useSocketSubscription';
import { getTenantRoom } from '../services/socket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const GOOGLE_TAG_ID = /\b(?:G|GT|AW|DC)-[A-Z0-9]+\b/i;
const ADS_CUSTOMER_ID = /^\d{3}-\d{3}-\d{4}$/;
const DEFAULT_GA_ID = 'G-B5E89JDV2B';

const TRIGGERS = [
  { value: 'contact_submit', label: 'Contact form sent' },
  { value: 'contact_open', label: 'Contact form opened' },
  { value: 'page_view', label: 'Every page view' },
];

const EMPTY_CONVERSION = {
  name: 'ads_conversion_Contact_Us_1',
  trigger: 'contact_submit',
  label: 'Contact us',
};

const EVENT_FILTERS = [
  { value: '', label: 'All' },
  { value: 'page_view', label: 'Page views' },
  { value: 'click', label: 'Clicks' },
  { value: 'contact_open', label: 'Contact opened' },
  { value: 'contact_submit', label: 'Messages sent' },
];

type Conversion = {
  id?: string;
  name: string;
  trigger: string;
  label: string;
};

type AnalyticsForm = {
  enabled: boolean;
  measurementId: string;
  adsId: string;
  campaignName: string;
  conversions: Conversion[];
};

type MineIp = { ip: string; label: string };

type SeriesPoint = {
  date: string;
  pageViews: number;
  visitors: number;
  clicks: number;
  contactOpens: number;
  contactSubmits: number;
};

type Report = {
  days: number;
  totals: {
    pageViews: number;
    visitors: number;
    clicks: number;
    contactOpens: number;
    contactSubmits: number;
  };
  series: SeriesPoint[];
  campaign: { adClicks: number; conversions: number };
  campaignSeries: Array<{ date: string; adClicks: number; conversions: number }>;
  pages: PageRow[];
  mineIps: MineIp[];
};

type PageVisitor = {
  ip: string;
  views: number;
  viewsToday: number;
  lastSeen: string | null;
  mine: boolean;
};

type PageRow = {
  path: string;
  views: number;
  viewsToday: number;
  visitors: PageVisitor[];
};

type TodayIp = {
  ip: string;
  views: number;
  lastAt: string;
  mine: boolean;
};

type TrafficEvent = {
  id: string;
  type: string;
  path: string;
  label: string;
  href: string;
  query: string;
  referrer: string;
  sessionId: string;
  ip: string;
  userAgent: string;
  mine: boolean;
  occurredAt: string;
};

const EMPTY_FORM: AnalyticsForm = {
  enabled: false,
  measurementId: DEFAULT_GA_ID,
  adsId: '',
  campaignName: 'Staircase Leads',
  conversions: [{ ...EMPTY_CONVERSION }],
};

const EMPTY_REPORT: Report = {
  days: 30,
  totals: { pageViews: 0, visitors: 0, clicks: 0, contactOpens: 0, contactSubmits: 0 },
  series: [],
  campaign: { adClicks: 0, conversions: 0 },
  campaignSeries: [],
  pages: [],
  mineIps: [],
};

function pacificToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function eventMatchesLog(event: TrafficEvent, eventType: string, query: string) {
  if (eventType && event.type !== eventType) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [event.ip, event.label, event.path, event.href, event.referrer].some((value) =>
    String(value || '').toLowerCase().includes(q),
  );
}

function looksLikeAdsCustomerId(value: string) {
  const compact = String(value || '').replace(/\s+/g, '');
  return ADS_CUSTOMER_ID.test(compact) || /^\d{8,12}$/.test(compact);
}

/** Drop quiet days before tracking started so the plot isn't a flat line across empty months. */
function seriesFromFirstActivity(series: SeriesPoint[]) {
  const first = series.findIndex(
    (row) => row.pageViews > 0 || row.clicks > 0 || row.contactOpens > 0 || row.contactSubmits > 0,
  );
  if (first <= 0) return series;
  return series.slice(first);
}

function formatDay(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** "Mon 3/9" — the hover tooltip has room for the weekday, the axis does not. */
function formatTooltipDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return format(new Date(year, month - 1, day), 'EEE M/d');
}

function eventLabel(type: string) {
  if (type === 'page_view') return 'Page view';
  if (type === 'click') return 'Click';
  if (type === 'contact_open') return 'Contact opened';
  if (type === 'contact_submit') return 'Message sent';
  return type;
}

function eventColor(type: string): 'default' | 'primary' | 'info' | 'warning' | 'success' {
  if (type === 'page_view') return 'primary';
  if (type === 'click') return 'info';
  if (type === 'contact_open') return 'warning';
  if (type === 'contact_submit') return 'success';
  return 'default';
}

function detailFor(event: TrafficEvent) {
  if (event.type === 'click') {
    return [event.label, event.href].filter(Boolean).join(' · ');
  }
  if (event.type === 'page_view') return event.query || 'Opened page';
  if (event.type === 'contact_open') return 'Opened contact form';
  if (event.type === 'contact_submit') return 'Sent contact form';
  return event.label || '—';
}

function TrafficChart({
  series,
  theme,
  hideClicks = false,
  viewLabel = 'Page views',
  convertLabel = 'Messages sent',
}: {
  series: SeriesPoint[];
  theme: Theme;
  hideClicks?: boolean;
  viewLabel?: string;
  convertLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const plotted = seriesFromFirstActivity(series);
  const width = 720;
  const height = 240;
  const pad = { l: 36, r: 16, t: 16, b: 32 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(1, ...plotted.map((row) => Math.max(row.pageViews, row.clicks, row.contactSubmits)));
  const points = plotted.map((row, index) => {
    const x = plotted.length <= 1 ? pad.l + innerW / 2 : pad.l + (index / (plotted.length - 1)) * innerW;
    return {
      ...row,
      x,
      y: pad.t + innerH - (row.pageViews / max) * innerH,
      clickY: pad.t + innerH - (row.clicks / max) * innerH,
      cy: pad.t + innerH - (row.contactSubmits / max) * innerH,
    };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${pad.l},${pad.t + innerH} ${line} ${pad.l + innerW},${pad.t + innerH}`;
  const clickLine = points.map((point) => `${point.x},${point.clickY}`).join(' ');
  const contactLine = points.map((point) => `${point.x},${point.cy}`).join(' ');
  const viewColor = theme.palette.primary.main;
  const clickColor = theme.palette.info.main;
  const contactColor = theme.palette.success.main;
  const ticks = plotted.filter((_, index) => {
    if (plotted.length <= 8) return true;
    const step = Math.ceil(plotted.length / 7);
    return index % step === 0 || index === plotted.length - 1;
  });
  // Each point owns a full-height band so the whole column is a hover target, not just the dot.
  const bandW = plotted.length > 1 ? innerW / (plotted.length - 1) : innerW;
  const active = hover == null ? null : points[hover];
  const rows = active
    ? [
        { label: viewLabel, value: active.pageViews, color: viewColor, y: active.y },
        ...(hideClicks ? [] : [{ label: 'Clicks', value: active.clicks, color: clickColor, y: active.clickY }]),
        { label: convertLabel, value: active.contactSubmits, color: contactColor, y: active.cy },
      ]
    : [];
  const boxW = 136;
  const boxH = 24 + rows.length * 15;
  // Flip to the left of the cursor near the right edge, and keep the card inside the plot.
  const boxX = active
    ? active.x + 12 + boxW > width - pad.r
      ? Math.max(pad.l, active.x - 12 - boxW)
      : active.x + 12
    : 0;
  const boxY = active ? Math.min(Math.max(pad.t, active.y - boxH / 2), pad.t + innerH - boxH) : 0;

  if (!plotted.length) return null;

  return (
    <Box sx={{ width: '100%', overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="240"
        role="img"
        aria-label="Website traffic"
        onMouseLeave={() => setHover(null)}
      >
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + innerH} stroke={theme.palette.divider} />
        <line x1={pad.l} y1={pad.t + innerH} x2={pad.l + innerW} y2={pad.t + innerH} stroke={theme.palette.divider} />
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={pad.l}
            x2={pad.l + innerW}
            y1={pad.t + innerH * (1 - frac)}
            y2={pad.t + innerH * (1 - frac)}
            stroke={theme.palette.divider}
            strokeDasharray="4 6"
          />
        ))}
        <polygon points={area} fill={alpha(viewColor, 0.18)} />
        <polyline points={line} fill="none" stroke={viewColor} strokeWidth="2.5" />
        {hideClicks ? null : <polyline points={clickLine} fill="none" stroke={clickColor} strokeWidth="2.5" />}
        <polyline points={contactLine} fill="none" stroke={contactColor} strokeWidth="2.5" />

        {/* Dots are only legible on shorter ranges; 90 days would be a solid row of circles. */}
        {plotted.length <= 31
          ? points.map((point) => (
              <circle
                key={`dot-${point.date}`}
                cx={point.x}
                cy={point.y}
                r={2.5}
                fill={theme.palette.background.paper}
                stroke={viewColor}
                strokeWidth="1.5"
              />
            ))
          : null}

        {ticks.map((row) => {
          const point = points.find((item) => item.date === row.date);
          if (!point) return null;
          return (
            <text key={row.date} x={point.x} y={height - 8} textAnchor="middle" fill={theme.palette.text.secondary} fontSize="11">
              {formatDay(row.date)}
            </text>
          );
        })}
        <text x={pad.l} y={12} fill={theme.palette.text.secondary} fontSize="11">
          {max}
        </text>

        {active ? (
          <g pointerEvents="none">
            <line
              x1={active.x}
              x2={active.x}
              y1={pad.t}
              y2={pad.t + innerH}
              stroke={theme.palette.text.secondary}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {rows.map((row) => (
              <circle
                key={`active-${row.label}`}
                cx={active.x}
                cy={row.y}
                r={4.5}
                fill={row.color}
                stroke={theme.palette.background.paper}
                strokeWidth="2"
              />
            ))}
            <rect
              x={boxX}
              y={boxY}
              width={boxW}
              height={boxH}
              rx={6}
              fill={theme.palette.background.paper}
              stroke={theme.palette.divider}
            />
            <text x={boxX + 10} y={boxY + 16} fontSize="11" fontWeight="700" fill={theme.palette.text.primary}>
              {formatTooltipDay(active.date)}
            </text>
            {rows.map((row, index) => {
              const ty = boxY + 31 + index * 15;
              return (
                <g key={`tip-${row.label}`}>
                  <rect x={boxX + 10} y={ty - 7} width={7} height={7} rx={1.5} fill={row.color} />
                  <text x={boxX + 23} y={ty} fontSize="11" fill={theme.palette.text.secondary}>
                    {row.label}
                  </text>
                  <text
                    x={boxX + boxW - 10}
                    y={ty}
                    fontSize="11"
                    fontWeight="700"
                    textAnchor="end"
                    fill={theme.palette.text.primary}
                  >
                    {row.value.toLocaleString()}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        {points.map((point, index) => (
          <rect
            key={`hit-${point.date}`}
            x={point.x - bandW / 2}
            y={pad.t}
            width={bandW}
            height={innerH}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(index)}
            onTouchStart={() => setHover(index)}
          />
        ))}
      </svg>
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-between', mt: -1, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          Hover a day for its numbers
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ color: viewColor }}>{viewLabel}</Typography>
          {hideClicks ? null : <Typography variant="caption" sx={{ color: clickColor }}>Clicks</Typography>}
          <Typography variant="caption" sx={{ color: contactColor }}>{convertLabel}</Typography>
        </Box>
      </Box>
    </Box>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  hint,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof ViewsIcon;
  color: string;
  hint?: string;
  onClick?: () => void;
}) {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        p: 2,
        border: `1px solid ${theme.palette.divider}`,
        borderLeft: `4px solid ${color}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.5, fontSize: { xs: '1.4rem', sm: '1.75rem' } }}>
            {value.toLocaleString()}
          </Typography>
          {hint ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {hint}
            </Typography>
          ) : null}
        </Box>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.18 : 0.1),
          }}
        >
          <Icon sx={{ fontSize: 22, color }} />
        </Box>
      </Box>
    </Paper>
  );
}

function WebsiteAnalyticsPage() {
  const theme = useTheme();
  const { tenantIdForBranding } = useAuth();
  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const live = useSocketConnectionStatus();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'campaign' ? 1 : 0;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [days, setDays] = useState(30);
  const [hideMine, setHideMine] = useState(() => {
    try {
      return localStorage.getItem('websiteAnalyticsNotMe') !== '0';
    } catch {
      return true;
    }
  });
  const [eventType, setEventType] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<AnalyticsForm>(EMPTY_FORM);
  const [report, setReport] = useState<Report>(EMPTY_REPORT);
  const [events, setEvents] = useState<TrafficEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [mineIps, setMineIps] = useState<MineIp[]>([]);
  const [expandedPages, setExpandedPages] = useState<Record<string, boolean>>({});
  const [todayIpsOpen, setTodayIpsOpen] = useState(false);
  const [todayIpsPath, setTodayIpsPath] = useState<string | null>(null);
  const [todayIpsLoading, setTodayIpsLoading] = useState(false);
  const [todayIps, setTodayIps] = useState<TodayIp[]>([]);
  const sessionsRef = useRef(new Set<string>());
  const filtersRef = useRef({ hideMine, eventType, query, mineIps });
  useEffect(() => {
    filtersRef.current = { hideMine, eventType, query, mineIps };
  }, [eventType, hideMine, mineIps, query]);

  const setTab = (next: number) => {
    setParams(next === 1 ? { tab: 'campaign' } : { tab: 'traffic' }, { replace: true });
  };

  const setNotMe = (next: boolean) => {
    setHideMine(next);
    try {
      localStorage.setItem('websiteAnalyticsNotMe', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const loadReport = useCallback(async (rangeDays = days, skipMine = hideMine) => {
    const [{ data }, reportRes] = await Promise.all([
      axios.get(`${API_URL}/website`),
      axios.get(`${API_URL}/website/analytics/report`, {
        params: { days: rangeDays, hideMine: skipMine ? '1' : '0' },
      }),
    ]);
    const analytics = data?.analytics || {};
    const conversions = Array.isArray(analytics.conversions) && analytics.conversions.length
      ? analytics.conversions
      : [{ ...EMPTY_CONVERSION }];
    setForm({
      enabled: Boolean(analytics.enabled),
      measurementId: analytics.measurementId || DEFAULT_GA_ID,
      adsId: analytics.adsId || '',
      campaignName: analytics.campaignName || 'Staircase Leads',
      conversions,
    });
    setMineIps(Array.isArray(analytics.mineIps) ? analytics.mineIps : reportRes.data?.mineIps || []);
    setReport({
      days: reportRes.data?.days || rangeDays,
      totals: { ...EMPTY_REPORT.totals, ...(reportRes.data?.totals || {}) },
      series: Array.isArray(reportRes.data?.series) ? reportRes.data.series : [],
      campaign: reportRes.data?.campaign || EMPTY_REPORT.campaign,
      campaignSeries: Array.isArray(reportRes.data?.campaignSeries) ? reportRes.data.campaignSeries : [],
      pages: Array.isArray(reportRes.data?.pages)
        ? reportRes.data.pages.map((row: Partial<PageRow>) => ({
            path: row.path || '/',
            views: row.views || 0,
            viewsToday: row.viewsToday || 0,
            visitors: Array.isArray(row.visitors) ? row.visitors : [],
          }))
        : [],
      mineIps: Array.isArray(reportRes.data?.mineIps) ? reportRes.data.mineIps : [],
    });
  }, [days, hideMine]);

  const loadEvents = useCallback(async (opts: { append?: boolean; before?: string; silent?: boolean } = {}) => {
    if (!opts.silent) setLogLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/website/analytics/events`, {
        params: {
          hideMine: hideMine ? '1' : '0',
          type: eventType || undefined,
          q: query.trim() || undefined,
          before: opts.append ? opts.before : undefined,
          limit: 40,
        },
      });
      const next = Array.isArray(data?.events) ? data.events : [];
      if (opts.append) {
        next.forEach((row) => {
          if (row.sessionId) sessionsRef.current.add(row.sessionId);
        });
      } else {
        sessionsRef.current = new Set(next.map((row) => row.sessionId).filter(Boolean));
      }
      setEvents((prev) => (opts.append ? [...prev, ...next] : next));
      setHasMore(Boolean(data?.hasMore));
      if (Array.isArray(data?.mineIps)) setMineIps(data.mineIps);
    } catch (error) {
      console.error('Error loading traffic log:', error);
      if (!opts.silent) toast.error('Failed to load traffic log');
    } finally {
      if (!opts.silent) setLogLoading(false);
    }
  }, [eventType, hideMine, query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await loadReport(days, hideMine);
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading website analytics:', error);
          toast.error('Failed to load website analytics');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days, hideMine, loadReport]);

  useEffect(() => {
    if (tab !== 0) return undefined;
    void loadEvents({ append: false });
    return undefined;
  }, [tab, hideMine, eventType, loadEvents]);

  const handleRealtime = useCallback((payload: unknown) => {
    const incoming = (payload as { event?: TrafficEvent } | null)?.event;
    if (!incoming?.id) return;
    const filters = filtersRef.current;
    const mine = filters.mineIps.some((row) => row.ip === incoming.ip);
    const event = { ...incoming, mine };
    if (filters.hideMine && mine) return;

    setReport((prev) => {
      const today = pacificToday();
      const totals = { ...prev.totals };
      const newVisitor =
        event.type === 'page_view' && Boolean(event.sessionId) && !sessionsRef.current.has(event.sessionId);
      if (newVisitor && event.sessionId) sessionsRef.current.add(event.sessionId);
      if (event.type === 'page_view') totals.pageViews += 1;
      if (event.type === 'click') totals.clicks += 1;
      if (event.type === 'contact_open') totals.contactOpens += 1;
      if (event.type === 'contact_submit') totals.contactSubmits += 1;
      if (newVisitor) totals.visitors += 1;
      const series = prev.series.map((row) => {
        if (row.date !== today) return row;
        return {
          ...row,
          pageViews: row.pageViews + (event.type === 'page_view' ? 1 : 0),
          clicks: row.clicks + (event.type === 'click' ? 1 : 0),
          contactOpens: row.contactOpens + (event.type === 'contact_open' ? 1 : 0),
          contactSubmits: row.contactSubmits + (event.type === 'contact_submit' ? 1 : 0),
          visitors: row.visitors + (newVisitor ? 1 : 0),
        };
      });
      let pages = prev.pages;
      if (event.type === 'page_view') {
        const liveVisitor: PageVisitor = {
          ip: event.ip || '',
          views: 1,
          viewsToday: 1,
          lastSeen: event.occurredAt,
          mine: Boolean(event.mine),
        };
        // A live event is by definition today, so both counters move together.
        const hit = pages.find((row) => row.path === event.path);
        pages = hit
          ? pages.map((row) => {
              if (row.path !== event.path) return row;
              const seen = (row.visitors || []).some((v) => v.ip === liveVisitor.ip);
              const visitors = seen
                ? (row.visitors || []).map((v) =>
                    v.ip === liveVisitor.ip
                      ? { ...v, views: v.views + 1, viewsToday: (v.viewsToday || 0) + 1, lastSeen: event.occurredAt }
                      : v,
                  )
                : [...(row.visitors || []), liveVisitor];
              return {
                ...row,
                views: row.views + 1,
                viewsToday: (row.viewsToday || 0) + 1,
                visitors: [...visitors].sort((a, b) => b.views - a.views).slice(0, 25),
              };
            })
          : [...pages, { path: event.path, views: 1, viewsToday: 1, visitors: [liveVisitor] }];
        pages = [...pages].sort((a, b) => b.views - a.views).slice(0, 8);
      }
      return { ...prev, totals, series, pages };
    });

    if (!eventMatchesLog(event, filters.eventType, filters.query)) return;
    setEvents((prev) => {
      if (prev.some((row) => row.id === event.id)) return prev;
      return [event, ...prev];
    });
  }, []);

  useSocketSubscription(tab === 0 ? tenantRoom : null, 'website.analytics.created', handleRealtime);

  const save = async () => {
    if (looksLikeAdsCustomerId(form.measurementId) || looksLikeAdsCustomerId(form.adsId)) {
      toast.error('That is the Google Ads account number. Use the AW- or G- tag ID instead.');
      return;
    }
    if (form.enabled && !GOOGLE_TAG_ID.test(form.measurementId)) {
      toast.error('Paste a Google tag ID (AW-, G-, or GT-) before turning this on');
      return;
    }
    try {
      setSaving(true);
      const { data } = await axios.put(`${API_URL}/website/analytics`, form);
      const analytics = data?.analytics || form;
      setForm({
        enabled: Boolean(analytics.enabled),
        measurementId: analytics.measurementId || DEFAULT_GA_ID,
        adsId: analytics.adsId || '',
        campaignName: analytics.campaignName || form.campaignName || 'Staircase Leads',
        conversions: analytics.conversions?.length ? analytics.conversions : [{ ...EMPTY_CONVERSION }],
      });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch (error) {
      console.error('Error saving website analytics:', error);
      const message = axios.isAxiosError(error) ? error.response?.data?.error : null;
      toast.error(message || 'Failed to save Google tag');
    } finally {
      setSaving(false);
    }
  };

  const updateConversion = (index: number, patch: Partial<Conversion>) => {
    setForm((prev) => ({
      ...prev,
      conversions: prev.conversions.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const togglePage = useCallback((path: string) => {
    setExpandedPages((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const openTodayIps = useCallback(async (path: string | null) => {
    setTodayIpsOpen(true);
    setTodayIpsPath(path);
    setTodayIpsLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/website/analytics/today-ips`, {
        params: {
          hideMine: hideMine ? '1' : '0',
          path: path || undefined,
        },
      });
      setTodayIps(Array.isArray(data?.ips) ? data.ips : []);
    } catch (error) {
      console.error('Error loading today IPs:', error);
      toast.error('Could not load today’s IPs');
      setTodayIps([]);
    } finally {
      setTodayIpsLoading(false);
    }
  }, [hideMine]);

  const setMine = async (ip: string, mine: boolean) => {
    try {
      const { data } = await axios.put(`${API_URL}/website/analytics/mine-ips`, { ip, mine, label: 'Me' });
      setMineIps(Array.isArray(data?.mineIps) ? data.mineIps : []);
      await loadReport(days, hideMine);
      if (tab === 0) await loadEvents({ append: false });
      if (todayIpsOpen) await openTodayIps(todayIpsPath);
    } catch (error) {
      console.error('Error updating mine IP:', error);
      toast.error('Could not update that IP');
    }
  };

  const hasTraffic = useMemo(
    () => report.totals.pageViews + report.totals.clicks + report.totals.contactOpens + report.totals.contactSubmits > 0,
    [report.totals],
  );

  // Today's row of the series, so the live socket updates feed this card for free.
  const todayStats = useMemo(() => {
    const today = pacificToday();
    return report.series.find((row) => row.date === today) || null;
  }, [report.series]);

  return (
    <Container maxWidth="lg" disableGutters sx={{ py: { xs: 1, sm: 4 }, px: { xs: 0, sm: 3 } }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h1" sx={{ mb: 1 }}>
          Website Analytics
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Google Campaign is this one ads campaign. Traffic Logging is every visit and click on the site.
        </Typography>
      </Box>

      <Paper sx={{ mb: 3 }}>
        <Tabs value={tab} onChange={(_, next) => setTab(next)} variant="scrollable" allowScrollButtonsMobile>
          <Tab label="Traffic Logging" />
          <Tab label="Google Campaign" />
        </Tabs>
      </Paper>

      {tab === 1 ? (
        <>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {form.campaignName || 'Staircase Leads'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Ad clicks that land on the site, and contact-form conversions from those visits. Spend and impressions stay in Google Ads.
              </Typography>
            </Box>
            <Chip
              size="small"
              color={form.enabled ? 'success' : 'default'}
              label={form.enabled ? `Connected · ${form.measurementId || DEFAULT_GA_ID}` : 'Tag off'}
            />
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' },
              gap: 2,
              mb: 3,
            }}
          >
            <StatCard label="Ad landings" value={report.campaign.adClicks} icon={ViewsIcon} color={theme.palette.primary.main} />
            <StatCard label="Conversions" value={report.campaign.conversions} icon={MailIcon} color={theme.palette.success.main} />
            <StatCard
              label="Conv. rate %"
              value={report.campaign.adClicks ? Math.round((report.campaign.conversions / report.campaign.adClicks) * 100) : 0}
              icon={PeopleIcon}
              color={theme.palette.info.main}
            />
          </Box>
          <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
              Campaign
            </Typography>
            {report.campaign.adClicks + report.campaign.conversions > 0 ? (
              <TrafficChart
                series={report.campaignSeries.map((row) => ({
                  date: row.date,
                  pageViews: row.adClicks,
                  visitors: 0,
                  clicks: 0,
                  contactOpens: 0,
                  contactSubmits: row.conversions,
                }))}
                theme={theme}
                hideClicks
                viewLabel="Ad landings"
                convertLabel="Conversions"
              />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                No Google ad clicks recorded yet. After the public site is deployed, visits with gclid from this campaign show here.
              </Typography>
            )}
          </Paper>
          <Accordion disableGutters sx={{ mb: 0, border: `1px solid ${theme.palette.divider}`, borderRadius: 1, '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>Google tag</Typography>
                <Typography variant="body2" color="text.secondary">
                  Already connected. Change the ID or conversion event here if you need to.
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" onClick={() => void save()} disabled={loading || saving} sx={{ textTransform: 'none' }}>
              {saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save'}
            </Button>
          </Box>
          <TextField
            label="Campaign name"
            value={form.campaignName}
            onChange={(e) => setForm((prev) => ({ ...prev, campaignName: e.target.value }))}
            fullWidth
            sx={{ mb: 2 }}
            disabled={loading}
          />
          <FormControlLabel
            control={
              <Switch
                checked={form.enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                disabled={loading}
              />
            }
            label="Send events to Google"
          />
          <TextField
            label="Google tag ID"
            value={form.measurementId}
            onChange={(e) => setForm((prev) => ({ ...prev, measurementId: e.target.value }))}
            placeholder={DEFAULT_GA_ID}
            fullWidth
            sx={{ mt: 2, mb: 2 }}
            disabled={loading}
            error={looksLikeAdsCustomerId(form.measurementId)}
            helperText={
              looksLikeAdsCustomerId(form.measurementId)
                ? 'That is the Ads account number. Use G-B5E89JDV2B (or an AW- tag).'
                : 'GA4 measurement ID'
            }
          />
          <TextField
            label="Google Ads ID (optional)"
            value={form.adsId}
            onChange={(e) => setForm((prev) => ({ ...prev, adsId: e.target.value }))}
            placeholder="AW-XXXXXXXX"
            fullWidth
            disabled={loading}
            error={looksLikeAdsCustomerId(form.adsId)}
            helperText="Only if Ads uses a separate AW- tag from this G- ID."
            sx={{ mb: 3 }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Conversion events
            </Typography>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  conversions: [...prev.conversions, { name: '', trigger: 'contact_submit', label: '' }],
                }))
              }
              sx={{ textTransform: 'none' }}
            >
              Add event
            </Button>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {form.conversions.map((row, index) => (
              <Box key={row.id || index} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <TextField
                  label="Event name"
                  size="small"
                  value={row.name}
                  onChange={(e) => updateConversion(index, { name: e.target.value })}
                  placeholder="ads_conversion_Contact_Us_1"
                  sx={{ flex: 2, minWidth: 220 }}
                />
                <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
                  <InputLabel>Fire when</InputLabel>
                  <Select
                    label="Fire when"
                    value={row.trigger}
                    onChange={(e) => updateConversion(index, { trigger: String(e.target.value) })}
                  >
                    {TRIGGERS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Label"
                  size="small"
                  value={row.label}
                  onChange={(e) => updateConversion(index, { label: e.target.value })}
                  placeholder="Contact us"
                  sx={{ flex: 1, minWidth: 140 }}
                />
                <IconButton
                  size="small"
                  color="error"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      conversions: prev.conversions.filter((_, i) => i !== index),
                    }))
                  }
                  aria-label="Remove event"
                  sx={{ mt: 0.5 }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>
            </AccordionDetails>
          </Accordion>
        </>
      ) : (
        <>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={hideMine ? 'not-me' : 'all'}
                onChange={(_, next) => {
                  if (next === 'not-me') setNotMe(true);
                  if (next === 'all') setNotMe(false);
                }}
              >
                <ToggleButton value="all" sx={{ textTransform: 'none' }}>
                  All traffic
                </ToggleButton>
                <ToggleButton value="not-me" sx={{ textTransform: 'none' }}>
                  Not me
                </ToggleButton>
              </ToggleButtonGroup>
              <Chip
                size="small"
                label={live ? 'Live' : 'Connecting…'}
                color={live ? 'success' : 'default'}
                variant={live ? 'filled' : 'outlined'}
              />
            </Box>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={days}
              onChange={(_, next) => {
                if (next) setDays(next);
              }}
            >
              <ToggleButton value={7} sx={{ textTransform: 'none' }}>7 days</ToggleButton>
              <ToggleButton value={30} sx={{ textTransform: 'none' }}>30 days</ToggleButton>
              <ToggleButton value={90} sx={{ textTransform: 'none' }}>90 days</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {mineIps.length ? (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              {mineIps.map((row) => (
                <Chip
                  key={row.ip}
                  size="small"
                  label={`${row.label}: ${row.ip}`}
                  onDelete={() => void setMine(row.ip, false)}
                />
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {hideMine
                ? 'Not me is on. Tap This is me on your own rows so shop visits stay and yours drop out of the counts and log.'
                : 'Tap This is me on your rows, then switch to Not me to see everyone else.'}
            </Typography>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)', lg: 'repeat(5, 1fr)' },
              gap: 2,
              mb: 3,
            }}
          >
            <StatCard
              label="Views today"
              value={todayStats?.pageViews || 0}
              icon={TodayIcon}
              color={theme.palette.warning.main}
              hint={todayStats ? `${(todayStats.visitors || 0).toLocaleString()} visitors today` : 'IPs from today’s page views'}
              onClick={() => void openTodayIps(null)}
            />
            <StatCard
              label="Page views"
              value={report.totals.pageViews}
              icon={ViewsIcon}
              color={theme.palette.primary.main}
              hint={`last ${report.days} days`}
            />
            <StatCard label="Visitors" value={report.totals.visitors} icon={PeopleIcon} color={theme.palette.info.main} />
            <StatCard label="Clicks" value={report.totals.clicks || 0} icon={MouseIcon} color={theme.palette.secondary.main} />
            <StatCard label="Messages sent" value={report.totals.contactSubmits} icon={MailIcon} color={theme.palette.success.main} />
          </Box>

          <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
              Traffic
            </Typography>
            {hasTraffic ? (
              <TrafficChart series={report.series} theme={theme} />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                {loading ? 'Loading…' : 'No visits yet. After the public site is deployed, open it and click around — this log stores in Liminnality.'}
              </Typography>
            )}
          </Paper>

          <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Top pages
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Last {report.days} days. Tap a page to see who opened it.
              </Typography>
            </Box>
            {report.pages.length ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 44 }} />
                    <TableCell sx={{ fontWeight: 700 }}>Page</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      Views
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      Views today
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      Visitors
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.pages.map((row) => {
                    const open = Boolean(expandedPages[row.path]);
                    const visitors = row.visitors || [];
                    return (
                      <Fragment key={row.path}>
                        <TableRow hover onClick={() => togglePage(row.path)} sx={{ cursor: 'pointer' }}>
                          <TableCell sx={{ py: 0.25 }}>
                            <IconButton size="small" aria-label={open ? 'Hide visitors' : 'Show visitors'}>
                              {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                            </IconButton>
                          </TableCell>
                          <TableCell>{row.path === '/' ? 'Home' : row.path}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {row.views.toLocaleString()}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: row.viewsToday ? 700 : 400,
                              color: row.viewsToday ? 'text.primary' : 'text.disabled',
                            }}
                          >
                            {(row.viewsToday || 0).toLocaleString()}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {visitors.length.toLocaleString()}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={5} sx={{ py: 0, border: open ? undefined : 0 }}>
                            <Collapse in={open} timeout="auto" unmountOnExit>
                              <Box sx={{ py: 1.5 }}>
                                {visitors.length ? (
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Who (IP address)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 600 }}>Views</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 600 }}>Today</TableCell>
                                        <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Last seen</TableCell>
                                        <TableCell sx={{ width: 104 }} />
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {visitors.map((visitor) => (
                                        <TableRow key={`${row.path}:${visitor.ip}`}>
                                          <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {visitor.ip || 'unknown'}
                                              </Typography>
                                              {visitor.mine ? <Chip size="small" label="Me" /> : null}
                                            </Box>
                                          </TableCell>
                                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                            {visitor.views.toLocaleString()}
                                          </TableCell>
                                          <TableCell
                                            align="right"
                                            sx={{
                                              fontVariantNumeric: 'tabular-nums',
                                              color: visitor.viewsToday ? 'text.primary' : 'text.disabled',
                                            }}
                                          >
                                            {(visitor.viewsToday || 0).toLocaleString()}
                                          </TableCell>
                                          <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                                            {visitor.lastSeen ? format(new Date(visitor.lastSeen), 'MMM d, h:mm a') : '—'}
                                          </TableCell>
                                          <TableCell>
                                            {visitor.ip ? (
                                              <Button
                                                size="small"
                                                onClick={() => void setMine(visitor.ip, !visitor.mine)}
                                                sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                                              >
                                                {visitor.mine ? 'Not me' : 'This is me'}
                                              </Button>
                                            ) : null}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                ) : (
                                  <Typography variant="body2" color="text.secondary">
                                    No IP addresses recorded for this page yet.
                                  </Typography>
                                )}
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Page totals appear here after the first visits.
              </Typography>
            )}
          </Paper>

          <Paper sx={{ p: { xs: 1.5, sm: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Hit log
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  size="small"
                  label="Search IP / click / page"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void loadEvents({ append: false });
                  }}
                  sx={{ minWidth: 220 }}
                />
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Type</InputLabel>
                  <Select label="Type" value={eventType} onChange={(e) => setEventType(String(e.target.value))}>
                    {EVENT_FILTERS.map((option) => (
                      <MenuItem key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button size="small" onClick={() => void loadEvents({ append: false })} sx={{ textTransform: 'none' }}>
                  Refresh
                </Button>
              </Box>
            </Box>
            <TableContainer sx={{ maxHeight: 'calc(100vh - 280px)', overflowX: 'auto' }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, minWidth: 160 }}>Time</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 120 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>What they did</TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 160 }}>IP</TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 120 }}>Page</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 110 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {logLoading && !events.length ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                        <CircularProgress size={28} />
                      </TableCell>
                    </TableRow>
                  ) : events.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                        <Typography color="text.secondary">
                          No hits yet. This is stored in Liminnality when someone uses the public website.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    events.map((event) => (
                      <TableRow key={event.id} hover sx={{ opacity: event.mine ? 0.55 : 1 }}>
                        <TableCell sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {event.occurredAt ? format(new Date(event.occurredAt), 'MMM d, h:mm:ss a') : '—'}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={eventLabel(event.type)} color={eventColor(event.type)} />
                          {event.mine ? <Chip size="small" label="Me" sx={{ ml: 0.5 }} /> : null}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{detailFor(event) || '—'}</Typography>
                          {event.referrer ? (
                            <Typography variant="caption" color="text.secondary" display="block">
                              from {event.referrer}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            {event.ip || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {event.path === '/' ? 'Home' : event.path}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {event.ip ? (
                            <Button size="small" onClick={() => void setMine(event.ip, !event.mine)} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
                              {event.mine ? 'Not me' : 'This is me'}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            {hasMore ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Button
                  variant="outlined"
                  onClick={() => void loadEvents({ append: true, before: events[events.length - 1]?.occurredAt })}
                  disabled={logLoading}
                  sx={{ textTransform: 'none' }}
                >
                  {logLoading ? 'Loading…' : 'Load more'}
                </Button>
              </Box>
            ) : null}
          </Paper>

          <Dialog open={todayIpsOpen} onClose={() => setTodayIpsOpen(false)} fullWidth maxWidth="sm">
            <DialogTitle>
              Views today
              {todayIpsPath ? ` · ${todayIpsPath === '/' ? 'Home' : todayIpsPath}` : ''}
            </DialogTitle>
            <DialogContent>
              {todayIpsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : todayIps.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2 }}>
                  No page views yet today.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>IP</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>Views</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Last seen</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {todayIps.map((row) => (
                      <TableRow key={row.ip || 'unknown'} hover>
                        <TableCell sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          {row.ip || '—'}
                          {row.mine ? <Chip size="small" label="Me" sx={{ ml: 0.5 }} /> : null}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {row.views.toLocaleString()}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {row.lastAt ? format(new Date(row.lastAt), 'h:mm:ss a') : '—'}
                        </TableCell>
                        <TableCell>
                          {row.ip ? (
                            <Button
                              size="small"
                              onClick={() => void setMine(row.ip, !row.mine)}
                              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                            >
                              {row.mine ? 'Not me' : 'This is me'}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </Container>
  );
}

export default WebsiteAnalyticsPage;
