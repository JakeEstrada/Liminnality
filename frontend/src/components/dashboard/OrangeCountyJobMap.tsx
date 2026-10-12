import { Box, Button, Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/axios';
import JobDetailModal from '../jobs/JobDetailModal';
import { chartPanelSx } from './dashboardChartPrimitives';

type MapPin = {
  id: string;
  title: string;
  stage: string;
  customerName: string;
  address: string;
  lat: number;
  lng: number;
  group?: 'unscheduled' | 'scheduled' | 'completed' | 'archived' | 'active';
  scheduled?: boolean;
  isArchived?: boolean;
  isDeadEstimate?: boolean;
};

type MapView = 'all' | 'pipeline' | 'current' | 'week' | 'completed' | 'archived';

const VIEWS: { id: MapView; label: string }[] = [
  { id: 'all', label: 'All jobs' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'current', label: 'On site now' },
  { id: 'week', label: 'This week' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
];

const PIN_COLORS: Record<string, string> = {
  unscheduled: '#f59e0b',
  scheduled: '#34d399',
  completed: '#34d399',
  archived: '#94a3b8',
  active: '#f59e0b',
};

function pinIcon(group = 'active') {
  const color = PIN_COLORS[group] || PIN_COLORS.active;
  return L.divIcon({
    className: 'paarth-job-pin',
    html: `<span class="paarth-job-pin-dot" style="background:${color}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
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

function pinLabel(pin: MapPin) {
  return pin.customerName || pin.title || 'Job';
}

function pinsForView(pins: Record<MapView, MapPin[]>, view: MapView) {
  const list = pins[view] || [];
  if (view === 'pipeline' || view === 'current' || view === 'week') {
    return list.filter((pin) => pin.group !== 'archived' && !pin.isArchived && !pin.isDeadEstimate);
  }
  return list;
}

const OC_CENTER: L.LatLngExpression = [33.67, -117.78];
const OC_BOUNDS = L.latLngBounds([33.34, -118.18], [33.98, -117.4]);
const MAP_THEME_KEY = 'ocJobMapThemeV1';
type MapTheme = 'satellite' | 'dark' | 'light' | 'streets' | 'terrain';

const MAP_THEMES: { id: MapTheme; label: string }[] = [
  { id: 'satellite', label: 'Satellite' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'streets', label: 'Streets' },
  { id: 'terrain', label: 'Terrain' },
];

function readMapTheme(): MapTheme {
  try {
    const saved = String(localStorage.getItem(MAP_THEME_KEY) || '').trim();
    if (MAP_THEMES.some((item) => item.id === saved)) return saved as MapTheme;
  } catch {
    /* ignore */
  }
  return 'satellite';
}

function mapboxToken() {
  return String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '').trim();
}

function mapboxLayer(style: string) {
  const token = mapboxToken();
  return L.tileLayer(
    `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/{z}/{x}/{y}?access_token=${token}`,
    {
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 18,
      attribution: '&copy; Mapbox &copy; OpenStreetMap',
    },
  );
}

function layersForTheme(themeId: MapTheme): L.TileLayer[] {
  const token = mapboxToken();
  if (token) {
    if (themeId === 'satellite') return [mapboxLayer('satellite-streets-v12')];
    if (themeId === 'dark') return [mapboxLayer('dark-v11')];
    if (themeId === 'light') return [mapboxLayer('light-v11')];
    if (themeId === 'streets') return [mapboxLayer('streets-v12')];
    return [mapboxLayer('outdoors-v12')];
  }
  if (themeId === 'dark') {
    return [
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }),
    ];
  }
  if (themeId === 'light') {
    return [
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }),
    ];
  }
  if (themeId === 'streets') {
    return [
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }),
    ];
  }
  if (themeId === 'terrain') {
    return [
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: '&copy; OpenStreetMap &copy; OpenTopoMap',
      }),
    ];
  }
  return [
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Tiles &copy; Esri',
    }),
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, pane: 'overlayPane' },
    ),
  ];
}

function applyBasemap(map: L.Map, themeId: MapTheme) {
  map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) map.removeLayer(layer);
  });
  layersForTheme(themeId).forEach((layer) => layer.addTo(map));
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
  const [view, setView] = useState<MapView>('pipeline');
  const [mapTheme, setMapTheme] = useState<MapTheme>(readMapTheme);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [pins, setPins] = useState<Record<MapView, MapPin[]>>({
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
    applyBasemap(map, mapTheme);
    const markers = L.layerGroup().addTo(map);
    mapRef.current = { map, markers };
    window.setTimeout(() => map.invalidateSize(), 80);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Theme swaps are handled below so the map instance is not rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    applyBasemap(ctx.map, mapTheme);
    try {
      localStorage.setItem(MAP_THEME_KEY, mapTheme);
    } catch {
      /* ignore */
    }
  }, [mapTheme]);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return undefined;
    const timer = window.setTimeout(() => ctx.map.invalidateSize(), 200);
    return () => window.clearTimeout(timer);
  }, [kiosk]);

  const visiblePins = useMemo(() => pinsForView(pins, view), [pins, view]);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    ctx.markers.clearLayers();
    const bounds = L.latLngBounds([]);
    visiblePins.forEach((pin) => {
      const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(pin.group), keyboard: true });
      marker.bindTooltip(escapeHtml(pinLabel(pin)), {
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
      bounds.extend([pin.lat, pin.lng]);
    });
    window.setTimeout(() => ctx.map.invalidateSize(), 40);
    if (bounds.isValid()) {
      ctx.map.fitBounds(bounds.pad(0.2), { maxZoom: 13, animate: true });
    } else {
      ctx.map.setView(OC_CENTER, 10);
    }
  }, [visiblePins]);

  const activePins = visiblePins;

  const handleJobUpdate = useCallback(async (jobId: string, updates: Record<string, unknown>) => {
    await api.patch(`/jobs/${jobId}`, updates);
  }, []);

  const closeJob = useCallback(() => {
    setOpenJobId(null);
  }, []);

  return (
    <Paper
      elevation={0}
      sx={{
        ...chartPanelSx(theme),
        display: { xs: kiosk ? 'flex' : 'none', md: 'flex' },
        minHeight: kiosk ? 0 : { md: 720 },
        height: kiosk ? '100%' : 'auto',
        flex: kiosk ? 1 : undefined,
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mb: 1, flexShrink: 0 }}>
        {VIEWS.map((item) => (
          <Button
            key={item.id}
            size="small"
            variant={view === item.id ? 'contained' : 'outlined'}
            onClick={() => setView(item.id)}
            sx={{ textTransform: 'none', minWidth: 0 }}
          >
            {item.label}
          </Button>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mb: 1.5, flexShrink: 0 }}>
        {MAP_THEMES.map((item) => (
          <Button
            key={item.id}
            size="small"
            variant={mapTheme === item.id ? 'contained' : 'outlined'}
            onClick={() => setMapTheme(item.id)}
            sx={{ textTransform: 'none', minWidth: 0 }}
          >
            {item.label}
          </Button>
        ))}
      </Box>
      <Box sx={{ mb: 1, flexShrink: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          Orange County jobs
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {activePins.length} mapped · hover a pin for the job · click to open · orange not
          scheduled · green scheduled · gray archived
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
            background: mapTheme === 'light' || mapTheme === 'streets' ? '#dbe4ea' : '#0b1c24',
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
          '& .paarth-job-tooltip.leaflet-tooltip-top::before': {
            borderTopColor: theme.palette.background.paper,
          },
        }}
      >
        <Box ref={hostRef} sx={{ position: 'absolute', inset: 0 }} />
        {!activePins.length ? (
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
            Jobs show up here after their street address is converted to a map point.
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
