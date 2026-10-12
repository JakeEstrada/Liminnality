/** Pathnames the assistant may request for in-app navigation (query strings allowed). */
const ALLOWED_PATHNAMES = new Set([
  '/dashboard',
  '/pipeline',
  '/outlook',
  '/messages',
  '/customers',
  '/calendar',
  '/tasks',
  '/archive',
  '/dead-estimates',
  '/completed-tasks',
  '/completed-jobs',
  '/website',
  '/developer/analytics',
  '/developer',
  '/payroll',
  '/bills',
  '/finance',
  '/takeoff-sheet',
  '/users',
  '/account-settings',
  '/calendar-view',
  '/pipeline-view',
  '/customers-view',
  '/dashboard-view',
]);

const SUPER_ADMIN_ONLY_PATHS = new Set([
  '/website',
  '/developer/analytics',
  '/developer',
  '/finance',
  '/users',
  '/bills',
]);

/**
 * @param {string} raw
 * @param {string} [role]
 * @returns {string|null} safe in-app path or null
 */
function sanitizeNavigatePath(raw, role) {
  const s = String(raw || '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  const pathname = s.split('?')[0];
  if (!ALLOWED_PATHNAMES.has(pathname)) return null;
  if (SUPER_ADMIN_ONLY_PATHS.has(pathname) && role !== 'super_admin') return null;
  const q = s.includes('?') ? `?${s.split('?').slice(1).join('?')}` : '';
  return pathname + q;
}

const ROUTES_MARKDOWN = `
Main app routes (path → purpose):
- /dashboard — overview, recent activity, and the Orange County jobs map (filter by city, name, stage, scheduled, amount)
- /dashboard-view — shop TV dashboard with the same map
- /pipeline — job pipeline board
- /messages — SMS inbox; ?tab=inbox is the team Outlook worksheets (admin)
- /outlook — redirects to /messages?tab=inbox
- /customers — customer list and records
- /calendar — calendar and scheduling
- /tasks — projects and tasks
- /archive — job archive (also /dead-estimates)
- /completed-tasks — completed tasks and appointments
- /completed-jobs — finished closed-out jobs
- /website — customer website homepage CMS (super admin only)
- /developer/analytics — Google campaign tag and first-party website traffic log (super admin only)
- /developer — internal developer tasks (super admin only)
- /payroll — payroll tools
- /bills — bills (super admin only)
- /finance — finance hub (super admin only; bank register, deposit linking, payment tracking)
- /takeoff-sheet — takeoff sheet
- /users — user management and activity log (super admin only)
- /account-settings — profile, password, org logo (super admin)
TV / kiosk-style views:
- /dashboard-view, /pipeline-view, /calendar-view, /customers-view

The top bar search uses the same tenant-scoped search as your \`global_search\` tool.
Paarth Help can also query recent payments/deposits and search job notes via dedicated tools.
`.trim();

module.exports = {
  ALLOWED_PATHNAMES,
  sanitizeNavigatePath,
  ROUTES_MARKDOWN,
};
