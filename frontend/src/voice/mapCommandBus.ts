export type MapViewId = 'all' | 'pipeline' | 'current' | 'week' | 'completed' | 'archived';

export type MapTourJob = {
  id: string;
  title?: string;
  customerName?: string;
  city?: string;
  distanceMiles?: number | null;
};

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
  jobs: MapTourJob[];
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

export function spokenMapJobLine(job: MapTourJob) {
  const name = String(job.customerName || job.title || 'This job').trim();
  const city = String(job.city || '').trim();
  return city ? `${name}, ${city}.` : `${name}.`;
}

export function mapTourIntro(command: MapShowCommand) {
  const count = command.jobs.length || command.jobIds.length;
  const noun = count === 1 ? 'job' : 'jobs';
  if (command.near) return `${count} ${noun} near ${command.near}.`;
  if (command.city) return `${count} ${noun} in ${command.city}.`;
  return `${count} ${noun} on the map.`;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

let tourAborted = false;
let stopTimedTour: (() => void) | null = null;

export function abortMapTour() {
  tourAborted = true;
  stopTimedTour?.();
  stopTimedTour = null;
  resetMapToPipeline();
}

export async function narrateMapTour(
  command: MapShowCommand,
  speak: (text: string) => Promise<void>,
) {
  tourAborted = false;
  const jobs =
    command.jobs.length > 0
      ? command.jobs
      : command.jobIds.filter(Boolean).map((id) => ({ id }));
  if (!jobs.length) {
    if (!tourAborted) await speak(mapTourIntro(command));
    if (!tourAborted) resetMapToPipeline();
    return;
  }
  try {
    if (tourAborted) return;
    await speak(mapTourIntro(command));
    for (const job of jobs) {
      if (tourAborted) return;
      highlightMapJobs({ jobId: job.id });
      await wait(350);
      if (tourAborted) return;
      await speak(spokenMapJobLine(job));
    }
  } finally {
    if (!tourAborted) resetMapToPipeline();
  }
}

export function startMapTour(jobIds: string[], durationMs: number) {
  const ids = jobIds.filter(Boolean);
  if (!ids.length) return () => resetMapToPipeline();
  const step = Math.max(2200, Math.floor(Math.max(durationMs, ids.length * 2200) / ids.length));
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
  const stop = () => {
    if (finished) return;
    finished = true;
    window.clearInterval(timer);
    resetMapToPipeline();
  };
  stopTimedTour = stop;
  return stop;
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
    jobs?: Array<{
      id?: string;
      title?: string;
      customerName?: string;
      city?: string;
      distanceMiles?: number | null;
      mapped?: boolean;
    }>;
    openFilters?: boolean;
  };
  if (row.type !== 'map_show') return undefined;
  const filters: Partial<MapShowCommand> = row.filters || {};
  const jobs = (row.jobs || [])
    .filter((job) => job?.id && job.mapped !== false)
    .map((job) => ({
      id: String(job.id),
      title: job.title,
      customerName: job.customerName,
      city: job.city,
      distanceMiles: job.distanceMiles,
    }));
  const jobIds =
    Array.isArray(row.jobIds) && row.jobIds.length
      ? row.jobIds.filter(Boolean)
      : jobs.map((job) => job.id);
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
    jobs: jobs.length ? jobs : jobIds.map((id) => ({ id })),
    openFilters: row.openFilters !== false,
    path: typeof row.path === 'string' ? row.path : undefined,
  };
}
