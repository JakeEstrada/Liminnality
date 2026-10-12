import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/axios';
import { formatMoney } from '../../utils/paymentSchedule';
import { subscribeMapCommands, type MapShowCommand, type MapViewId } from '../../voice/mapCommandBus';
import JobDetailModal from '../jobs/JobDetailModal';
import { chartPanelSx } from './dashboardChartPrimitives';

type MapPin = {
  id: string;
  title: string;
  stage: string;
  customerName: string;
  city?: string;
  amount?: number;
  address: string;
  lat: number;
  lng: number;
  group?: 'unscheduled' | 'scheduled' | 'completed' | 'archived' | 'active';
  scheduled?: boolean;
  isArchived?: boolean;
  isDeadEstimate?: boolean;
};

type MapFilters = {
  query: string;
  city: string;
  stage: string;
  scheduled: 'any' | 'yes' | 'no';
  minAmount: string;
  maxAmount: string;
  jobIds: string[];
};

const EMPTY_FILTERS: MapFilters = {
  query: '',
  city: '',
  stage: '',
  scheduled: 'any',
  minAmount: '',
  maxAmount: '',
  jobIds: [],
};

const VIEWS: { id: MapViewId; label: string }[] = [
  { id: 'all', label: 'All jobs' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'current', label: 'On site now' },
  { id: 'week', label: 'This week' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
];

const STAGE_LABELS: Record<string, string> = {
  DEPOSIT_PENDING: 'Signed / deposit pending',
  JOB_PREP: 'Job prep',
  TAKEOFF_COMPLETE: 'Fabrication',
  READY_TO_SCHEDULE: 'Ready to schedule',
  SCHEDULED: 'Scheduled',
  IN_PRODUCTION: 'In production',
  INSTALLED: 'Installed',
  FINAL_PAYMENT_CLOSED: 'Final payment closed',
  CONTRACT_SIGNED: 'Contract signed',
};

const PIN_COLORS: Record<string, string> = {
  unscheduled: '#f59e0b',
  scheduled: '#34d399',
  completed: '#34d399',
  archived: '#94a3b8',
  active: '#f59e0b',
};

const CITY_ALIASES: Record<string, string> = {
  'dana pt': 'dana point',
  'sj clemente': 'san clemente',
  's clemente': 'san clemente',
};

function normalizePlace(value: string) {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/\bcalifornia\b|\bca\b/g, ' ')
    .replace(/\bpt\.?\b/g, 'point')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CITY_ALIASES[cleaned] || cleaned;
}

function placeMatch(hay: string, needle: string) {
  const a = normalizePlace(hay);
  const b = normalizePlace(needle);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function pinIcon(group = 'active', featured = false) {
  const color = PIN_COLORS[group] || PIN_COLORS.active;
  return L.divIcon({
    className: 'paarth-job-pin',
    html: `<span class="paarth-job-pin-dot${featured ? ' is-featured' : ''}" style="background:${color}"></span>`,
    iconSize: featured ? [28, 28] : [22, 22],
    iconAnchor: featured ? [14, 14] : [11, 11],
    popupAnchor: [0, -12],
  });
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pinLabel(pin: MapPin, hideSensitive: boolean) {
  const name = pin.customerName || pin.title || 'Job';
  const city = pin.city ? ` · ${pin.city}` : '';
  const amount = !hideSensitive && pin.amount ? ` · ${formatMoney(pin.amount)}` : '';
  return `${name}${city}${amount}`;
}

function pinsForView(pins: Record<MapViewId, MapPin[]>, view: MapViewId) {
  const list = pins[view] || [];
  if (view === 'pipeline' || view === 'current' || view === 'week') {
    return list.filter((pin) => pin.group !== 'archived' && !pin.isArchived && !pin.isDeadEstimate);
  }
  return list;
}

function pinMatches(pin: MapPin, filters: MapFilters) {
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const hay = `${pin.title} ${pin.customerName} ${pin.city} ${pin.address}`.toLowerCase();
    if (!hay.includes(query)) return false;
  }
  if (filters.city && !placeMatch(`${pin.city || ''} ${pin.address || ''}`, filters.city)) {
    return false;
  }
  if (filters.stage && pin.stage !== filters.stage) return false;
  if (filters.scheduled === 'yes' && !pin.scheduled) return false;
  if (filters.scheduled === 'no' && pin.scheduled) return false;
  const amount = Number(pin.amount) || 0;
  const min = Number(filters.minAmount);
  const max = Number(filters.maxAmount);
  if (Number.isFinite(min) && filters.minAmount !== '' && amount < min) return false;
  if (Number.isFinite(max) && filters.maxAmount !== '' && amount > max) return false;
  if (filters.jobIds.length && !filters.jobIds.includes(pin.id)) return false;
  return true;
}

const OC_CENTER: L.LatLngExpression = [33.67, -117.78];
const OC_BOUNDS = L.latLngBounds([33.34, -118.18], [33.98, -117.4]);

function addBasemap(map: L.Map) {
  const mapbox = String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '').trim();
  if (mapbox) {
    L.tileLayer(
      `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${mapbox}`,
      {
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 18,
        attribution: '&copy; Mapbox &copy; OpenStreetMap',
      },
    ).addTo(map);
    return;
  }

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Tiles &copy; Esri',
  }).addTo(map);
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18, pane: 'overlayPane' },
  ).addTo(map);
}

export default function OrangeCountyJobMap({
  hideSensitive = false,
  kiosk = false,
}: {
  hideSensitive?: boolean;
  kiosk?: boolean;
} = {}) {
  const theme = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ map: L.Map; markers: L.LayerGroup } | null>(null);
  const markerByIdRef = useRef<Map<string, { marker: L.Marker; pin: MapPin }>>(new Map());
  const [view, setView] = useState<MapViewId>('pipeline');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [filters, setFilters] = useState<MapFilters>(EMPTY_FILTERS);
  const [featuredJobId, setFeaturedJobId] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [pins, setPins] = useState<Record<MapViewId, MapPin[]>>({
    all: [],
    pipeline: [],
    current: [],
    week: [],
    completed: [],
    archived: [],
  });

  useEffect(() => {
    let cancelled = false;
    void api
      .get('/jobs/map-pins')
      .then((response) => {
        if (cancelled) return;
        setPins({
          all: response.data?.all || [],
          pipeline: response.data?.pipeline || [],
          current: response.data?.current || [],
          week: response.data?.week || [],
          completed: response.data?.completed || [],
          archived: response.data?.archived || [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPins({ all: [], pipeline: [], current: [], week: [], completed: [], archived: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, {
      center: OC_CENTER,
      zoom: 10,
      minZoom: 9,
      maxZoom: 18,
      maxBounds: OC_BOUNDS.pad(0.08),
      scrollWheelZoom: true,
      attributionControl: true,
    });
    addBasemap(map);
    const markers = L.layerGroup().addTo(map);
    mapRef.current = { map, markers };
    window.setTimeout(() => map.invalidateSize(), 80);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return undefined;
    const timer = window.setTimeout(() => ctx.map.invalidateSize(), 200);
    return () => window.clearTimeout(timer);
  }, [kiosk, filtersOpen]);

  const viewPins = useMemo(() => pinsForView(pins, view), [pins, view]);
  const visiblePins = useMemo(() => viewPins.filter((pin) => pinMatches(pin, filters)), [filters, viewPins]);
  const cities = useMemo(() => {
    const unique = new Set(
      viewPins.map((pin) => String(pin.city || '').trim()).filter(Boolean),
    );
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [viewPins]);
  const stages = useMemo(() => {
    const unique = new Set(viewPins.map((pin) => pin.stage).filter(Boolean));
    return [...unique].sort((a, b) =>
      (STAGE_LABELS[a] || a).localeCompare(STAGE_LABELS[b] || b),
    );
  }, [viewPins]);
  const filtersActive =
    Boolean(filters.query.trim()) ||
    Boolean(filters.city) ||
    Boolean(filters.stage) ||
    filters.scheduled !== 'any' ||
    filters.minAmount !== '' ||
    filters.maxAmount !== '' ||
    filters.jobIds.length > 0;

  useEffect(() => {
    return subscribeMapCommands({
      show: (command: MapShowCommand) => {
        setFiltersOpen(command.openFilters !== false);
        if (command.view) setView(command.view);
        setFilters({
          query: command.query || '',
          city: command.city || '',
          stage: command.stage || '',
          scheduled: command.scheduled || 'any',
          minAmount: command.minAmount != null ? String(command.minAmount) : '',
          maxAmount: command.maxAmount != null ? String(command.maxAmount) : '',
          jobIds: command.jobIds || [],
        });
        setFeaturedJobId(command.jobIds?.[0] || null);
      },
      highlight: (command) => {
        if (command.jobId) {
          setFeaturedJobId(command.jobId);
          return;
        }
        setFeaturedJobId(command.jobIds?.[0] || null);
      },
    });
  }, []);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    ctx.markers.clearLayers();
    markerByIdRef.current.clear();
    const bounds = L.latLngBounds([]);
    visiblePins.forEach((pin) => {
      const marker = L.marker([pin.lat, pin.lng], {
        icon: pinIcon(pin.group, false),
        keyboard: true,
      });
      marker.bindTooltip(escapeHtml(pinLabel(pin, hideSensitive)), {
        direction: 'top',
        offset: [0, -12],
        opacity: 1,
        sticky: true,
        className: 'paarth-job-tooltip',
      });
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        setOpenJobId(pin.id);
      });
      marker.addTo(ctx.markers);
      markerByIdRef.current.set(pin.id, { marker, pin });
      bounds.extend([pin.lat, pin.lng]);
    });
    window.setTimeout(() => ctx.map.invalidateSize(), 40);
    if (bounds.isValid()) {
      ctx.map.fitBounds(bounds.pad(visiblePins.length === 1 ? 0.35 : 0.2), {
        maxZoom: visiblePins.length === 1 ? 15 : 14,
        animate: true,
      });
    } else {
      ctx.map.setView(OC_CENTER, 10);
    }
  }, [hideSensitive, visiblePins]);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    markerByIdRef.current.forEach(({ marker, pin }, id) => {
      const featured = id === featuredJobId;
      marker.setIcon(pinIcon(pin.group, featured));
      marker.setZIndexOffset(featured ? 800 : 0);
      marker.unbindTooltip();
      marker.bindTooltip(escapeHtml(pinLabel(pin, hideSensitive)), {
        direction: 'top',
        offset: [0, -12],
        opacity: 1,
        sticky: !featured,
        permanent: featured,
        className: featured ? 'paarth-job-tooltip is-featured' : 'paarth-job-tooltip',
      });
      if (featured) marker.openTooltip();
      else marker.closeTooltip();
    });
    const featured = featuredJobId ? markerByIdRef.current.get(featuredJobId) : null;
    if (featured) {
      ctx.map.panTo([featured.pin.lat, featured.pin.lng], { animate: true });
    }
  }, [featuredJobId, hideSensitive, visiblePins]);

  const handleJobUpdate = useCallback(async (jobId: string, updates: Record<string, unknown>) => {
    await api.patch(`/jobs/${jobId}`, updates);
  }, []);

  const closeJob = useCallback(() => {
    setOpenJobId(null);
  }, []);

  const fieldSx = { minWidth: { xs: '100%', sm: 140 }, flex: { sm: '0 0 auto' } };

  return (
    <Paper
      id="orange-county-job-map"
      elevation={0}
      sx={{
        ...chartPanelSx(theme),
        display: { xs: kiosk ? 'flex' : 'none', md: 'flex' },
        minHeight: kiosk ? 0 : { md: 720 },
        height: kiosk ? '100%' : 'auto',
        flex: kiosk ? 1 : undefined,
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mb: 1.5, flexShrink: 0 }}>
        {VIEWS.map((item) => (
          <Button
            key={item.id}
            size="small"
            variant={view === item.id ? 'contained' : 'outlined'}
            onClick={() => {
              setView(item.id);
              setFilters((current) => ({ ...current, jobIds: [] }));
            }}
            sx={{ textTransform: 'none', minWidth: 0 }}
          >
            {item.label}
          </Button>
        ))}
        <Button
          size="small"
          variant={filtersOpen ? 'contained' : 'outlined'}
          onClick={() => setFiltersOpen((open) => !open)}
          sx={{ textTransform: 'none', minWidth: 0, ml: 'auto' }}
        >
          Filters
        </Button>
      </Box>
      {filtersOpen ? (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            mb: 1.5,
            flexShrink: 0,
          }}
        >
          <TextField
            size="small"
            label="Name"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value, jobIds: [] }))}
            sx={{ minWidth: { xs: '100%', sm: 180 }, flex: 1 }}
          />
          <FormControl size="small" sx={fieldSx}>
            <InputLabel>City</InputLabel>
            <Select
              label="City"
              value={filters.city}
              onChange={(event) => setFilters((current) => ({ ...current, city: String(event.target.value), jobIds: [] }))}
            >
              <MenuItem value="">All cities</MenuItem>
              {cities.map((city) => (
                <MenuItem key={city} value={city}>
                  {city}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={fieldSx}>
            <InputLabel>Stage</InputLabel>
            <Select
              label="Stage"
              value={filters.stage}
              onChange={(event) => setFilters((current) => ({ ...current, stage: String(event.target.value), jobIds: [] }))}
            >
              <MenuItem value="">All stages</MenuItem>
              {stages.map((stage) => (
                <MenuItem key={stage} value={stage}>
                  {STAGE_LABELS[stage] || stage}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={fieldSx}>
            <InputLabel>Scheduled</InputLabel>
            <Select
              label="Scheduled"
              value={filters.scheduled}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  scheduled: event.target.value as MapFilters['scheduled'],
                  jobIds: [],
                }))
              }
            >
              <MenuItem value="any">Any</MenuItem>
              <MenuItem value="yes">Scheduled</MenuItem>
              <MenuItem value="no">Not scheduled</MenuItem>
            </Select>
          </FormControl>
          {hideSensitive ? null : (
            <>
              <TextField
                size="small"
                label="Min $"
                type="number"
                value={filters.minAmount}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, minAmount: event.target.value, jobIds: [] }))
                }
                sx={{ width: 110 }}
              />
              <TextField
                size="small"
                label="Max $"
                type="number"
                value={filters.maxAmount}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, maxAmount: event.target.value, jobIds: [] }))
                }
                sx={{ width: 110 }}
              />
            </>
          )}
          {filtersActive ? (
            <Button
              size="small"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setFeaturedJobId(null);
              }}
              sx={{ textTransform: 'none' }}
            >
              Clear
            </Button>
          ) : null}
        </Box>
      ) : null}
      <Box sx={{ mb: 1, flexShrink: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          Orange County jobs
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {visiblePins.length} mapped{filtersActive ? ' · filtered' : ''} · hover a pin for the job ·
          click to open · orange not scheduled · green scheduled · gray archived
        </Typography>
      </Box>
      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: kiosk ? 0 : 620,
          borderRadius: 2,
          overflow: 'hidden',
          '& .leaflet-container': {
            height: '100%',
            width: '100%',
            background: '#0b1c24',
            fontFamily: 'inherit',
          },
          '& .paarth-job-pin': { background: 'none', border: 0, cursor: 'pointer' },
          '& .paarth-job-pin-dot': {
            display: 'block',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
          },
          '& .paarth-job-pin-dot.is-featured': {
            width: 24,
            height: 24,
            boxShadow: '0 0 0 4px rgba(56, 189, 248, 0.9), 0 0 18px 6px rgba(14, 165, 233, 0.55)',
            animation: 'paarth-pin-pulse 0.9s ease-in-out infinite',
          },
          '@keyframes paarth-pin-pulse': {
            '0%': { transform: 'scale(1)' },
            '50%': { transform: 'scale(1.18)' },
            '100%': { transform: 'scale(1)' },
          },
          '& .paarth-job-tooltip': {
            background: theme.palette.background.paper,
            color: theme.palette.text.primary,
            border: 'none',
            borderRadius: 8,
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 8px 24px rgba(0,0,0,0.45)'
                : '0 8px 24px rgba(15, 23, 42, 0.18)',
            fontWeight: 700,
            fontSize: 13,
            padding: '6px 10px',
          },
          '& .paarth-job-tooltip.is-featured': {
            outline: '2px solid #38bdf8',
          },
          '& .paarth-job-tooltip.leaflet-tooltip-top::before': {
            borderTopColor: theme.palette.background.paper,
          },
        }}
      >
        <Box ref={hostRef} sx={{ position: 'absolute', inset: 0 }} />
        {!visiblePins.length ? (
          <Typography
            variant="body2"
            color="common.white"
            sx={{
              position: 'absolute',
              left: 16,
              bottom: 16,
              maxWidth: 360,
              zIndex: 500,
              textShadow: '0 1px 4px rgba(0,0,0,0.7)',
            }}
          >
            {filtersActive
              ? 'No mapped jobs match these filters.'
              : 'Jobs show up here after their street address is converted to a map point.'}
          </Typography>
        ) : null}
      </Box>
      <JobDetailModal
        jobId={openJobId}
        open={Boolean(openJobId)}
        onClose={closeJob}
        onJobUpdate={handleJobUpdate}
        onJobDelete={closeJob}
        onJobArchive={closeJob}
        hideSensitive={hideSensitive}
        shopDisplayMode={kiosk}
      />
    </Paper>
  );
}
