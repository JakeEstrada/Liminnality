export type JobOverlayCommand = {
  jobId: string;
  tab?: string;
};

type JobOverlayListener = (command: JobOverlayCommand | null) => void;

const listeners = new Set<JobOverlayListener>();

const JOB_PATHS = new Set([
  '/pipeline',
  '/customers',
  '/archive',
  '/completed-jobs',
  '/pipeline-view',
  '/customers-view',
]);

export function parseJobOverlayPath(path?: string | null): JobOverlayCommand | null {
  if (!path) return null;
  try {
    const url = new URL(path, 'http://paarth.local');
    const jobId = url.searchParams.get('jobId');
    if (!jobId || !JOB_PATHS.has(url.pathname)) return null;
    return { jobId, tab: 'files' };
  } catch {
    return null;
  }
}

export function parseOpenJobAction(action: unknown): JobOverlayCommand | null {
  if (!action || typeof action !== 'object') return null;
  const row = action as { type?: string; jobId?: string; tab?: string };
  if (row.type !== 'open_job' || !row.jobId) return null;
  return { jobId: String(row.jobId), tab: row.tab || 'files' };
}

export function openJobOverlay(command: JobOverlayCommand) {
  const jobId = String(command?.jobId || '').trim();
  if (!jobId) return;
  const next = { jobId, tab: command.tab || 'files' };
  listeners.forEach((listener) => listener(next));
}

export function closeJobOverlay() {
  listeners.forEach((listener) => listener(null));
}

export function subscribeJobOverlay(listener: JobOverlayListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function applyJobOverlayActions(actions: unknown[]) {
  if (!Array.isArray(actions)) return false;
  let opened = false;
  for (const action of actions) {
    const fromAction = parseOpenJobAction(action);
    if (fromAction) {
      openJobOverlay(fromAction);
      opened = true;
      continue;
    }
    const row = action as { type?: string; path?: string };
    if (row?.type === 'navigate' && typeof row.path === 'string') {
      const fromPath = parseJobOverlayPath(row.path);
      if (fromPath) {
        openJobOverlay(fromPath);
        opened = true;
      }
    }
  }
  return opened;
}
