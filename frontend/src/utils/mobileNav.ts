/**
 * Mobile navigation allowlist — phones only get the pages that are usable on a small
 * screen. Anything else (dashboard, finance, admin tooling) redirects to the calendar.
 */
export const MOBILE_HOME_PATH = '/calendar';

export const MOBILE_NAV_PATHS = [
  '/calendar',
  '/pipeline',
  '/customers',
  '/commission-logs',
  '/developer/analytics',
  '/metrics',
];

/** Reachable on a phone but not listed in the drawer (opened from the avatar menu). */
const MOBILE_UTILITY_PATHS = ['/account-settings'];

function normalizePath(pathname: string): string {
  const path = String(pathname || '')
    .split('?')[0]
    .replace(/\/+$/, '');
  return path || '/';
}

export function isMobileAllowedPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return [...MOBILE_NAV_PATHS, ...MOBILE_UTILITY_PATHS].some(
    (allowed) => path === allowed || path.startsWith(`${allowed}/`),
  );
}
