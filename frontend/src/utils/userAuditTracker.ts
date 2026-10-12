import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const PATH_LABELS: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/pipeline': 'Pipeline',
  '/outlook': 'Team Inbox',
  '/customers': 'Customers',
  '/calendar': 'Calendar',
  '/tasks': 'Projects & Tasks',
  '/messages': 'Messages',
  '/finance': 'Finance Hub',
  '/bills': 'Bills',
  '/payroll': 'Payroll',
  '/rfid-timesheets': 'Payroll',
  '/commission-logs': 'Commission Logs',
  '/takeoff-sheet': 'Take Off Sheet',
  '/vendors': 'Vendors',
  '/users': 'Users',
  '/archive': 'Job Archive',
  '/completed-jobs': 'Completed Jobs',
  '/completed-tasks': 'Weekly Activity Log',
  '/website': 'Website',
  '/developer/analytics': 'Website Analytics',
  '/developer': 'Developer Tasks',
  '/account-settings': 'Account Settings',
  '/rfid': 'RFID scans',
  '/dashboard-view': 'Dashboard (shop display)',
  '/pipeline-view': 'Pipeline (shop display)',
  '/calendar-view': 'Calendar (shop display)',
  '/customers-view': 'Customers (shop display)',
};

type AuditType = 'page_view' | 'click';

type QueuedAuditEvent = {
  type: AuditType;
  label: string;
  path: string;
  detail: string;
  occurredAt: string;
};

const queue: QueuedAuditEvent[] = [];
const MAX_QUEUE = 80;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let lastPageKey = '';
let lastPageAt = 0;
let lastClickKey = '';
let lastClickAt = 0;

function clip(value: unknown, max: number): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function describeAuditPath(pathname: string, search = ''): string {
  const cleanPath = pathname.split('#')[0] || '/';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const tab = params.get('tab');
  const base = PATH_LABELS[cleanPath] || cleanPath;
  if (tab) return `${base} · ${tab.replace(/-/g, ' ')}`;
  return base;
}

export function normalizeAuditPath(pathname: string, search = ''): string {
  const cleanPath = pathname.split('#')[0] || '/';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const tab = params.get('tab');
  return tab ? `${cleanPath}?tab=${tab}` : cleanPath;
}

function enqueue(event: QueuedAuditEvent) {
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(event);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushUserAuditLogs();
    }, 800);
  }
}

export function trackPageView(pathname: string, search = '') {
  if (!pathname || pathname === '/login' || pathname === '/register') return;
  const path = normalizeAuditPath(pathname, search);
  const now = Date.now();
  const key = path;
  if (key === lastPageKey && now - lastPageAt < 1500) return;
  lastPageKey = key;
  lastPageAt = now;
  const pageName = describeAuditPath(pathname, search);
  enqueue({
    type: 'page_view',
    label: `Opened ${pageName}`,
    path,
    detail: '',
    occurredAt: new Date().toISOString(),
  });
}

export function trackClick(label: string, pathname: string, search = '') {
  const text = clip(label, 80);
  if (!text) return;
  const path = normalizeAuditPath(pathname, search);
  const now = Date.now();
  const key = `${path}::${text}`;
  if (key === lastClickKey && now - lastClickAt < 600) return;
  lastClickKey = key;
  lastClickAt = now;
  enqueue({
    type: 'click',
    label: `Clicked ${text}`,
    path,
    detail: '',
    occurredAt: new Date().toISOString(),
  });
}

export async function flushUserAuditLogs(): Promise<void> {
  if (flushing || queue.length === 0) return;
  if (!localStorage.getItem('accessToken')) {
    queue.length = 0;
    return;
  }
  flushing = true;
  const events = queue.splice(0, MAX_QUEUE);
  try {
    await axios.post(`${API_URL}/audit-logs`, { events });
  } catch {
    // Put them back if the session is still valid; drop them on 401.
    if (localStorage.getItem('accessToken') && queue.length < MAX_QUEUE) {
      queue.unshift(...events.slice(0, MAX_QUEUE - queue.length));
    }
  } finally {
    flushing = false;
    if (queue.length && !flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushUserAuditLogs();
      }, 800);
    }
  }
}
