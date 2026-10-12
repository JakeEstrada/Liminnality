export type MapViewId = 'all' | 'pipeline' | 'current' | 'week' | 'completed' | 'archived';

export type MapShowCommand = {
  query?: string;
  city?: string;
  near?: string;
  radiusMiles?: number;
  stage?: string;
  scheduled?: 'any' | 'yes' | 'no';
  minAmount?: number | null;
  maxAmount?: number | null;
  view?: MapViewId;
  jobIds: string[];
  openFilters?: boolean;
  path?: string;
};

export type MapHighlightCommand = {
  jobId?: string | null;
  jobIds?: string[];
};

type MapListener = {
  show?: (command: MapShowCommand) => void;
  highlight?: (command: MapHighlightCommand) => void;
  reset?: () => void;
};

let lastShow: MapShowCommand | null = null;
const listeners = new Set<MapListener>();

export function getLastMapShow() {
  return lastShow;
}

export function applyMapShow(command: MapShowCommand) {
  lastShow = command;
  listeners.forEach((listener) => listener.show?.(command));
  if (typeof document !== 'undefined') {
    window.setTimeout(() => {
      document.getElementById('orange-county-job-map')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
  }
}

export function highlightMapJobs(command: MapHighlightCommand) {
  listeners.forEach((listener) => listener.highlight?.(command));
}

export function subscribeMapCommands(listener: MapListener) {
  listeners.add(listener);
  if (lastShow) listener.show?.(lastShow);
  return () => {
    listeners.delete(listener);
  };
}

export function resetMapToPipeline() {
  lastShow = null;
  listeners.forEach((listener) => listener.reset?.());
}

export function startMapTour(jobIds: string[], durationMs: number) {
  const ids = jobIds.filter(Boolean);
  if (!ids.length) return () => resetMapToPipeline();
  const step = Math.max(1600, Math.floor(Math.max(durationMs, 2400) / ids.length));
  let index = 0;
  let finished = false;
  highlightMapJobs({ jobId: ids[0] });
  const timer = window.setInterval(() => {
    index += 1;
    if (index >= ids.length) {
      window.clearInterval(timer);
      return;
    }
    highlightMapJobs({ jobId: ids[index] });
  }, step);
  return () => {
    if (finished) return;
    finished = true;
    window.clearInterval(timer);
    resetMapToPipeline();
  };
}

export function estimateSpeechMs(text: string) {
  const chars = String(text || '').length;
  return Math.min(22000, Math.max(2800, chars * 68));
}

export function parseMapShowAction(action: unknown): MapShowCommand | undefined {
  if (!action || typeof action !== 'object') return undefined;
  const row = action as {
    type?: string;
    path?: string;
    filters?: MapShowCommand;
    jobIds?: string[];
    jobs?: Array<{ id?: string; mapped?: boolean }>;
    openFilters?: boolean;
  };
  if (row.type !== 'map_show') return undefined;
  const filters: Partial<MapShowCommand> = row.filters || {};
  const jobIds =
    Array.isArray(row.jobIds) && row.jobIds.length
      ? row.jobIds.filter(Boolean)
      : (row.jobs || []).filter((job) => job?.mapped && job.id).map((job) => String(job.id));
  return {
    query: filters.query,
    city: filters.near ? undefined : filters.city,
    near: filters.near,
    radiusMiles: Number(filters.radiusMiles) > 0 ? Number(filters.radiusMiles) : undefined,
    stage: filters.stage,
    scheduled: filters.scheduled,
    minAmount: filters.minAmount,
    maxAmount: filters.maxAmount,
    view: filters.view && filters.view !== 'all' ? filters.view : 'pipeline',
    jobIds,
    openFilters: row.openFilters !== false,
    path: typeof row.path === 'string' ? row.path : undefined,
  };
}
