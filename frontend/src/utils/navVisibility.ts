/** Sidebar pages the user cannot hide. */
export const LOCKED_NAV_PATHS = ['/dashboard', '/pipeline', '/customers', '/calendar'] as const;

export type NavVisibilityItem = {
  path: string;
  label: string;
  group: string;
  locked?: boolean;
  superAdminOnly?: boolean;
};

export const NAV_VISIBILITY_ITEMS: NavVisibilityItem[] = [
  { path: '/dashboard', label: 'Dashboard', group: 'Workspace', locked: true },
  { path: '/pipeline', label: 'Pipeline', group: 'Workspace', locked: true },
  { path: '/customers', label: 'Customers', group: 'Workspace', locked: true },
  { path: '/tasks', label: 'Projects & Tasks', group: 'Workspace' },
  { path: '/calendar', label: 'Calendar', group: 'Workspace', locked: true },
  { path: '/messages', label: 'Messages', group: 'Workspace' },
  { path: '/metrics', label: 'Metrics', group: 'Finance', superAdminOnly: true },
  { path: '/bills', label: 'Bills', group: 'Finance', superAdminOnly: true },
  { path: '/payroll', label: 'Payroll', group: 'Finance' },
  { path: '/commission-logs', label: 'Commission Logs', group: 'Finance' },
  { path: '/takeoff-sheet', label: 'Take Off Sheet', group: 'Operations' },
  { path: '/vendors', label: 'Vendors', group: 'Operations' },
  { path: '/users', label: 'Users', group: 'Operations', superAdminOnly: true },
  { path: '/archive', label: 'Job Archive', group: 'Archive & History' },
  { path: '/completed-jobs', label: 'Completed Jobs', group: 'Archive & History' },
  { path: '/developer', label: 'Developer', group: 'Developer', superAdminOnly: true },
  { path: '/developer/analytics', label: 'Website Analytics', group: 'Developer', superAdminOnly: true },
];

export const NAV_VISIBILITY_EVENT = 'paarth:nav-visibility';

const STORAGE_PREFIX = 'paarth-hidden-nav:';

export function isLockedNavPath(path: string) {
  return (LOCKED_NAV_PATHS as readonly string[]).includes(path);
}

export function sanitizeHiddenNavPaths(paths: unknown) {
  const allowed = new Set(
    NAV_VISIBILITY_ITEMS.filter((item) => !item.locked).map((item) => item.path),
  );
  const list = Array.isArray(paths) ? paths : [];
  return [...new Set(list.map((path) => String(path || '').trim()))].filter((path) => allowed.has(path));
}

export function readHiddenNavPaths(userId?: string | null) {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    return sanitizeHiddenNavPaths(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function writeHiddenNavPaths(userId: string, paths: string[]) {
  const hidden = sanitizeHiddenNavPaths(paths);
  window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(hidden));
  window.dispatchEvent(new CustomEvent(NAV_VISIBILITY_EVENT));
  return hidden;
}

export function hiddenNavPathsForUser(user?: { _id?: string; hiddenNavPaths?: string[] } | null) {
  if (Array.isArray(user?.hiddenNavPaths)) return sanitizeHiddenNavPaths(user.hiddenNavPaths);
  return readHiddenNavPaths(user?._id);
}
