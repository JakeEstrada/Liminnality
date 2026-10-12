import { useId, useMemo, useState } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { type Theme } from '@mui/material/styles';
import { format } from 'date-fns';

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
};

export type ChartPoint = {
  date: string;
  [key: string]: string | number;
};

function formatAxisDay(date: string) {
  const [, month, day] = String(date).split('-');
  if (!month || !day) return date;
  return `${Number(month)}/${Number(day)}`;
}

function formatTipDay(date: string) {
  const [year, month, day] = String(date).split('-').map(Number);
  if (!year || !month || !day) return date;
  return format(new Date(year, month - 1, day), 'EEE M/d');
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const padded = value * 1.12;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  return Math.ceil(padded / magnitude) * magnitude;
}

export function compactMoney(value: number) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `$${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.5, minHeight: 22 }}>
      {series.map((item) => (
        <Box key={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: item.color }} />
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function ScatterChart({
  points,
  height = 240,
  formatValue,
  hideSensitive = false,
}: {
  points: { t: number; y: number; label: string }[];
  height?: number;
  formatValue?: (value: number) => string;
  hideSensitive?: boolean;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const pad = { l: 58, r: 16, t: 16, b: 30 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const showValue = formatValue || ((value: number) => String(Math.round(value)));
  const range = useMemo(() => {
    const end = Date.now();
    return { end, start: end - 29 * 24 * 60 * 60 * 1000 };
  }, []);
  const { start, end: now } = range;
  const plotted = useMemo(() => {
    const rows = points
      .filter((point) => Number.isFinite(point.t) && point.t >= start && point.t <= now + 12 * 60 * 60 * 1000)
      .sort((a, b) => a.t - b.t);
    const used = new Map<string, number>();
    return rows.map((point) => {
      const key = `${Math.round(point.t / 3600000)}:${Math.round(point.y)}`;
      const bump = used.get(key) || 0;
      used.set(key, bump + 1);
      return { ...point, bump };
    });
  }, [now, points, start]);
  const max = useMemo(() => {
    if (hideSensitive) return 1;
    return niceMax(Math.max(0, ...plotted.map((point) => point.y)));
  }, [hideSensitive, plotted]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => start + (now - start) * frac);

  const dots = plotted.map((point) => {
    const x = pad.l + ((point.t - start) / (now - start)) * innerW + point.bump * 5;
    const y = hideSensitive
      ? pad.t + innerH * 0.45 - point.bump * 6
      : pad.t + innerH - (point.y / max) * innerH;
    return { ...point, x: Math.min(pad.l + innerW, Math.max(pad.l, x)), y };
  });
  const active = hover == null ? null : dots[hover];
  const boxW = 160;
  const boxH = 44;
  const boxX = active
    ? active.x + 12 + boxW > width - pad.r
      ? Math.max(pad.l, active.x - 12 - boxW)
      : active.x + 12
    : 0;
  const boxY = active ? Math.min(Math.max(pad.t, active.y - boxH - 8), pad.t + innerH - boxH) : 0;

  return (
    <Box sx={{ width: '100%', minWidth: 0 }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img">
        {yTicks.map((frac) => {
          const y = pad.t + innerH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={pad.l} x2={pad.l + innerW} y1={y} y2={y} stroke={theme.palette.divider} strokeDasharray="4 6" />
              {hideSensitive ? null : (
                <text x={pad.l - 8} y={y + 4} textAnchor="end" fill={theme.palette.text.secondary} fontSize="11">
                  {showValue(max * frac)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + innerH} stroke={theme.palette.divider} />
        <line
          x1={pad.l}
          y1={pad.t + innerH}
          x2={pad.l + innerW}
          y2={pad.t + innerH}
          stroke={theme.palette.divider}
        />
        {xTicks.map((time) => {
          const x = pad.l + ((time - start) / (now - start)) * innerW;
          return (
            <text
              key={time}
              x={x}
              y={height - 8}
              textAnchor="middle"
              fill={theme.palette.text.secondary}
              fontSize="11"
            >
              {format(new Date(time), 'M/d')}
            </text>
          );
        })}
        {dots.map((point, index) => (
          <circle
            key={`${point.t}-${point.y}-${index}`}
            cx={point.x}
            cy={point.y}
            r={hover === index ? 6 : 4.5}
            fill="#34d399"
            stroke={theme.palette.background.paper}
            strokeWidth="1.5"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {active ? (
          <g pointerEvents="none">
            <rect
              x={boxX}
              y={boxY}
              width={boxW}
              height={boxH}
              rx={8}
              fill={theme.palette.background.paper}
              stroke={theme.palette.divider}
            />
            <text x={boxX + 10} y={boxY + 18} fill={theme.palette.text.primary} fontSize="12" fontWeight={700}>
              {active.label}
            </text>
            <text x={boxX + 10} y={boxY + 34} fill={theme.palette.text.secondary} fontSize="11">
              {hideSensitive ? 'Locked' : `${showValue(active.y)} · ${format(new Date(active.t), 'MMM d')}`}
            </text>
          </g>
        ) : null}
      </svg>
    </Box>
  );
}

export function AreaChart({
  data,
  series,
  height = 240,
  formatValue,
  showDots = false,
  onDayClick,
}: {
  data: ChartPoint[];
  series: ChartSeries[];
  height?: number;
  formatValue?: (value: number) => string;
  showDots?: boolean;
  onDayClick?: (date: string) => void;
}) {
  const theme = useTheme();
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const pad = { l: 58, r: 16, t: 16, b: 30 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const showValue = formatValue || ((value: number) => String(Math.round(value)));
  const max = useMemo(() => {
    const peak = Math.max(
      0,
      ...data.flatMap((row) => series.map((item) => Number(row[item.key]) || 0)),
    );
    return niceMax(peak);
  }, [data, series]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const points = data.map((row, index) => {
    const x = data.length <= 1 ? pad.l + innerW / 2 : pad.l + (index / (data.length - 1)) * innerW;
    const ys: Record<string, number> = {};
    series.forEach((item) => {
      ys[item.key] = pad.t + innerH - ((Number(row[item.key]) || 0) / max) * innerH;
    });
    return { row, x, ys };
  });

  const ticks = data.filter((_, index) => {
    if (data.length <= 8) return true;
    const step = Math.ceil(data.length / 7);
    return index % step === 0 || index === data.length - 1;
  });

  const active = hover == null ? null : points[hover];
  const boxW = 148;
  const boxH = 22 + series.length * 16;
  const boxX = active
    ? active.x + 12 + boxW > width - pad.r
      ? Math.max(pad.l, active.x - 12 - boxW)
      : active.x + 12
    : 0;
  const boxY = active
    ? Math.min(Math.max(pad.t, (Object.values(active.ys)[0] || pad.t) - boxH / 2), pad.t + innerH - boxH)
    : 0;

  return (
    <Box sx={{ width: '100%', minWidth: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((item) => (
            <linearGradient key={item.key} id={`fill-${uid}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.38" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {yTicks.map((frac) => {
          const y = pad.t + innerH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={pad.l} x2={pad.l + innerW} y1={y} y2={y} stroke={theme.palette.divider} strokeDasharray="4 6" />
              <text
                x={pad.l - 8}
                y={y + 4}
                textAnchor="end"
                fill={theme.palette.text.secondary}
                fontSize="11"
              >
                {showValue(max * frac)}
              </text>
            </g>
          );
        })}
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + innerH} stroke={theme.palette.divider} />
        <line
          x1={pad.l}
          y1={pad.t + innerH}
          x2={pad.l + innerW}
          y2={pad.t + innerH}
          stroke={theme.palette.divider}
        />
        {series.map((item) => {
          const line = points.map((point) => `${point.x},${point.ys[item.key] ?? pad.t + innerH}`).join(' ');
          const area = `${pad.l},${pad.t + innerH} ${line} ${pad.l + innerW},${pad.t + innerH}`;
          return (
            <g key={item.key}>
              <polygon points={area} fill={`url(#fill-${uid}-${item.key})`} />
              <polyline
                points={line}
                fill="none"
                stroke={item.color}
                strokeWidth="2.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {showDots
                ? points.map((point) => (
                    <circle
                      key={`${item.key}-${point.row.date}`}
                      cx={point.x}
                      cy={point.ys[item.key]}
                      r={3}
                      fill={item.color}
                      stroke={theme.palette.background.paper}
                      strokeWidth="1.5"
                    />
                  ))
                : null}
            </g>
          );
        })}
        {ticks.map((row) => {
          const point = points.find((item) => item.row.date === row.date);
          if (!point) return null;
          return (
            <text
              key={row.date}
              x={point.x}
              y={height - 8}
              textAnchor="middle"
              fill={theme.palette.text.secondary}
              fontSize="11"
            >
              {formatAxisDay(row.date)}
            </text>
          );
        })}
        {data.map((_, index) => {
          const bandW = data.length > 1 ? innerW / (data.length - 1) : innerW;
          return (
            <rect
              key={`hit-${index}`}
              x={points[index].x - bandW / 2}
              y={pad.t}
              width={bandW}
              height={innerH}
              fill="transparent"
              style={{ cursor: onDayClick ? 'pointer' : 'default' }}
              onMouseEnter={() => setHover(index)}
              onClick={() => {
                const date = String(data[index]?.date || '');
                if (date && onDayClick) onDayClick(date);
              }}
            />
          );
        })}
        {active ? (
          <g pointerEvents="none">
            <line
              x1={active.x}
              x2={active.x}
              y1={pad.t}
              y2={pad.t + innerH}
              stroke={theme.palette.text.secondary}
              strokeDasharray="3 3"
            />
            {series.map((item) => (
              <circle
                key={item.key}
                cx={active.x}
                cy={active.ys[item.key]}
                r={5}
                fill={item.color}
                stroke={theme.palette.background.paper}
                strokeWidth="2"
              />
            ))}
            <rect
              x={boxX}
              y={boxY}
              width={boxW}
              height={boxH}
              rx={8}
              fill={theme.palette.background.paper}
              stroke={theme.palette.divider}
            />
            <text x={boxX + 10} y={boxY + 16} fontSize="11" fontWeight="700" fill={theme.palette.text.primary}>
              {formatTipDay(String(active.row.date))}
            </text>
            {series.map((item, index) => (
              <text
                key={item.key}
                x={boxX + 10}
                y={boxY + 32 + index * 16}
                fontSize="11"
                fill={item.color}
              >
                {item.label}: {showValue(Number(active.row[item.key]) || 0)}
              </text>
            ))}
          </g>
        ) : null}
      </svg>
      <ChartLegend series={series} />
    </Box>
  );
}

function donutArc(cx: number, cy: number, r: number, start: number, end: number) {
  const startX = cx + r * Math.cos(start);
  const startY = cy + r * Math.sin(start);
  const endX = cx + r * Math.cos(end);
  const endY = cy + r * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${startX} ${startY} A ${r} ${r} 0 ${large} 1 ${endX} ${endY}`;
}

export function DonutChart({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: { label: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const theme = useTheme();
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0) || 1;
  const cx = 96;
  const cy = 96;
  const r = 64;
  let angle = -Math.PI / 2;
  const arcs = slices
    .filter((slice) => slice.value > 0)
    .map((slice) => {
      const sweep = (slice.value / total) * Math.PI * 2;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      return { ...slice, sweep, d: donutArc(cx, cy, r, start, end) };
    });

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        flex: 1,
        minHeight: 280,
      }}
    >
      <Box sx={{ position: 'relative', width: 192, height: 192, flexShrink: 0 }}>
        <svg viewBox="0 0 192 192" width="192" height="192">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={theme.palette.divider} strokeWidth="20" />
          {arcs.map((arc) =>
            arc.sweep >= Math.PI * 1.999 ? (
              <circle key={arc.label} cx={cx} cy={cy} r={r} fill="none" stroke={arc.color} strokeWidth="20" />
            ) : (
              <path key={arc.label} d={arc.d} fill="none" stroke={arc.color} strokeWidth="20" strokeLinecap="butt" />
            ),
          )}
        </svg>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
            {centerValue}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {centerLabel}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, width: '100%', maxWidth: 220 }}>
        {slices.map((slice) => (
          <Box key={slice.label} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: slice.color, flexShrink: 0 }} />
              <Typography variant="body2" noWrap>
                {slice.label}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {slice.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function chartPanelSx(theme: Theme) {
  return {
    p: { xs: 2, sm: 2.25 },
    borderRadius: 3,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
    minWidth: 0,
    minHeight: { md: 420 },
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    boxShadow:
      theme.palette.mode === 'dark' ? '0 1px 0 rgba(255,255,255,0.04)' : '0 8px 24px rgba(15, 23, 42, 0.05)',
  };
}
