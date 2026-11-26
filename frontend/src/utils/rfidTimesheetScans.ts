import { addDays, format, startOfDay } from 'date-fns';
import {
  formatPayPeriodDayHeader,
  getPayPeriodDayDates,
  periodDays,
  type PayPeriod,
} from './payPeriod';

/** Scans within this window count as one tap (reader sensitivity / double reads). */
export const RFID_SCAN_BURST_MS = 5 * 60 * 1000;

export const RFID_DEFAULT_SHIFT_IN = '600';
export const RFID_DEFAULT_SHIFT_OUT = '1430';
export const RFID_DEFAULT_BREAK_MINUTES = 30;

/** Only auto-apply lunch break when the shift is longer than this (minutes). */
export const RFID_MIN_SHIFT_FOR_BREAK_MINUTES = 60;

export const AUTO_LOGOUT_NOTE = 'Auto log out';
export const AUTO_LOGIN_NOTE = 'Auto log in';

/** A lone punch this close to (or after) shift end is a clock-out, not a clock-in. */
export const RFID_LATE_OUT_LOOKBACK_MINUTES = 60;

export type RfidScanRecord = {
  _id?: string;
  uid?: string;
  pin?: string;
  displayName?: string;
  scannedAt: string | Date;
};

export type RfidEmployeeIdentity = {
  /** Stable key — normalized display name */
  id: string;
  name: string;
  uids: string[];
  pins: string[];
};

export type RfidRosterProfile = {
  employeeKey?: string;
  displayName?: string;
  /** false hides the person from payroll and keeps their tag, PIN, and phone. */
  onRoster?: boolean;
};

export type RosterDirectoryRow = RfidEmployeeIdentity & {
  onPayroll: boolean;
  phones: string[];
};

export type RfidEmployeeShiftProfile = {
  shiftIn: string;
  shiftOut: string;
  breakMinutes: number;
  ratePerHour?: string;
};

export type RfidDayClock = {
  in: string;
  out: string;
  breaks: string;
  scanCount: number;
  note: string;
  autoLogout: boolean;
  autoLogin: boolean;
};

export type RfidManualDayFlags = {
  in?: boolean;
  out?: boolean;
  breaks?: boolean;
  note?: boolean;
};

export function defaultShiftProfile(): RfidEmployeeShiftProfile {
  return {
    shiftIn: RFID_DEFAULT_SHIFT_IN,
    shiftOut: RFID_DEFAULT_SHIFT_OUT,
    breakMinutes: RFID_DEFAULT_BREAK_MINUTES,
    ratePerHour: '',
  };
}

/** A blank or zero rate is unset. A week rate wins; otherwise use the employee rate. */
export function preferHourlyRate(weekRate?: string | null, profileRate?: string | null): string {
  const week = positiveHourlyRate(weekRate);
  if (week) return week;
  return positiveHourlyRate(profileRate);
}

function positiveHourlyRate(value?: string | null): string {
  let raw = String(value ?? '').trim();
  if (raw.endsWith('.')) raw = raw.slice(0, -1);
  if (!raw) return '';
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return raw;
}

export function normalizeEmployeeKey(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const ROSTER_HEADER_NAMES = new Set(['name', 'employee', 'employee name', 'display name', 'roster']);

function collectRegistry(
  tags: Array<{ _id: string; uid: string; displayName: string }>,
  pins: Array<{ _id: string; pin: string; displayName: string }>,
  phones: Array<{ _id: string; phone?: string; phoneDigits?: string; displayName: string }>,
): Map<string, RfidEmployeeIdentity> {
  const byKey = new Map<string, RfidEmployeeIdentity>();

  const take = (nameRaw: string) => {
    const name = String(nameRaw || '').trim();
    if (!name) return null;
    const key = normalizeEmployeeKey(name);
    let row = byKey.get(key);
    if (!row) {
      row = { id: key, name, uids: [], pins: [] };
      byKey.set(key, row);
    }
    return row;
  };

  for (const tag of tags) {
    const row = take(tag.displayName);
    if (row && tag.uid && !row.uids.includes(tag.uid)) row.uids.push(tag.uid);
  }

  for (const pinEntry of pins) {
    const row = take(pinEntry.displayName);
    if (row && pinEntry.pin && !row.pins.includes(pinEntry.pin)) row.pins.push(pinEntry.pin);
  }

  for (const phoneEntry of phones) {
    const row = take(phoneEntry.displayName);
    const digits = String(phoneEntry.phoneDigits || '').replace(/\D/g, '').slice(-10);
    const uid = digits ? `SMS-${digits}` : '';
    if (row && uid && !row.uids.includes(uid)) row.uids.push(uid);
  }

  return byKey;
}

function rosterKey(profile: RfidRosterProfile): string {
  return normalizeEmployeeKey(profile.employeeKey || profile.displayName || '');
}

function applyRoster(byKey: Map<string, RfidEmployeeIdentity>, roster: RfidRosterProfile[]) {
  const hidden = new Set<string>();
  for (const profile of roster) {
    const key = rosterKey(profile);
    if (!key) continue;
    if (profile.onRoster === false) {
      hidden.add(key);
      continue;
    }
    if (profile.onRoster === true && !byKey.has(key)) {
      const name = String(profile.displayName || profile.employeeKey || '').trim();
      if (name) byKey.set(key, { id: key, name, uids: [], pins: [] });
    }
  }
  for (const key of hidden) byKey.delete(key);
  return hidden;
}

export function mergeRfidRegistries(
  tags: Array<{ _id: string; uid: string; displayName: string }>,
  pins: Array<{ _id: string; pin: string; displayName: string }>,
  phones: Array<{ _id: string; phone?: string; phoneDigits?: string; displayName: string }> = [],
  roster: RfidRosterProfile[] = [],
): RfidEmployeeIdentity[] {
  const byKey = collectRegistry(tags, pins, phones);
  applyRoster(byKey, roster);
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Everyone with a saved name or number, including people taken off payroll. */
export function listRosterDirectory(
  tags: Array<{ _id: string; uid: string; displayName: string }>,
  pins: Array<{ _id: string; pin: string; displayName: string }>,
  phones: Array<{ _id: string; phone?: string; phoneDigits?: string; displayName: string }> = [],
  roster: RfidRosterProfile[] = [],
): RosterDirectoryRow[] {
  const byKey = collectRegistry(tags, pins, phones);
  const hidden = new Set<string>();
  const explicitOn = new Set<string>();
  for (const profile of roster) {
    const key = rosterKey(profile);
    if (!key) continue;
    if (profile.onRoster === false) hidden.add(key);
    if (profile.onRoster === true) explicitOn.add(key);
    if (!byKey.has(key)) {
      const name = String(profile.displayName || profile.employeeKey || '').trim();
      if (name) byKey.set(key, { id: key, name, uids: [], pins: [] });
    }
  }

  const phonesByKey = new Map<string, string[]>();
  for (const phoneEntry of phones) {
    const key = normalizeEmployeeKey(phoneEntry.displayName);
    const label = String(phoneEntry.phone || phoneEntry.phoneDigits || '').trim();
    if (!key || !label) continue;
    const list = phonesByKey.get(key) || [];
    if (!list.includes(label)) list.push(label);
    phonesByKey.set(key, list);
  }

  return Array.from(byKey.values())
    .map((person) => {
      const phonesForPerson = phonesByKey.get(person.id) || [];
      const tagUids = person.uids.filter((uid) => !uid.startsWith('SMS-'));
      const hasSavedNumber = tagUids.length > 0 || person.pins.length > 0 || phonesForPerson.length > 0;
      return {
        ...person,
        uids: tagUids,
        onPayroll: !hidden.has(person.id) && (hasSavedNumber || explicitOn.has(person.id)),
        phones: phonesForPerson,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function splitRosterLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (ch === ',' || ch === '\t')) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Names from a pasted list or a CSV/text file. Extra columns are ignored. */
export function parseRosterNames(text: string): string[] {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const firstCells = splitRosterLine(lines[0]);
  const headerIndex = firstCells.findIndex((cell) => ROSTER_HEADER_NAMES.has(cell.toLowerCase()));
  const body = headerIndex >= 0 ? lines.slice(1) : lines;
  const column = headerIndex >= 0 ? headerIndex : 0;
  const rawNames =
    body.length === 1 && headerIndex < 0 && splitRosterLine(body[0]).length > 1
      ? splitRosterLine(body[0])
      : body.map((line) => {
          const cells = splitRosterLine(line);
          return cells[column] || cells[0] || '';
        });

  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of rawNames) {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    const key = normalizeEmployeeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Felix (or other preferred keys) first, then alphabetical. */
export function sortEmployeesForTimesheet(
  employees: RfidEmployeeIdentity[],
  preferredFirstKeys: string[] = ['felix'],
): RfidEmployeeIdentity[] {
  return [...employees].sort((a, b) => {
    const aRank = preferredFirstKeys.indexOf(a.id);
    const bRank = preferredFirstKeys.indexOf(b.id);
    if (aRank !== -1 || bRank !== -1) {
      if (aRank === -1) return 1;
      if (bRank === -1) return -1;
      return aRank - bRank;
    }
    return a.name.localeCompare(b.name);
  });
}

export function scanMatchesEmployee(scan: RfidScanRecord, employee: RfidEmployeeIdentity): boolean {
  const uid = String(scan.uid || '').trim();
  const pin = String(scan.pin || '').trim();
  if (uid && employee.uids.includes(uid)) return true;
  if (pin && employee.pins.includes(pin)) return true;
  const scanName = normalizeEmployeeKey(String(scan.displayName || ''));
  return scanName.length > 0 && scanName === employee.id;
}

export function dedupeScanTimes(sortedTimes: Date[], burstMs = RFID_SCAN_BURST_MS): Date[] {
  if (sortedTimes.length === 0) return [];
  const deduped: Date[] = [sortedTimes[0]];
  for (let i = 1; i < sortedTimes.length; i += 1) {
    const prev = deduped[deduped.length - 1];
    const current = sortedTimes[i];
    if (current.getTime() - prev.getTime() >= burstMs) {
      deduped.push(current);
    }
  }
  return deduped;
}

export function minutesToTimeInput(minutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${hours}${String(mins).padStart(2, '0')}`;
}

function localDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function clockFromScanTimes(times: Date[]): { in: string; out: string } {
  if (times.length === 0) return { in: '0', out: '0' };
  const first = times[0];
  const inToken = minutesToTimeInput(first.getHours() * 60 + first.getMinutes());
  if (times.length === 1) return { in: inToken, out: '0' };
  const last = times[times.length - 1];
  return {
    in: inToken,
    out: minutesToTimeInput(last.getHours() * 60 + last.getMinutes()),
  };
}

function minutesFromTimeToken(token: string): number {
  if (!token || token === '0') return -1;
  const padded = String(token).replace(/\D/g, '').padStart(4, '0');
  const hours = Number.parseInt(padded.substring(0, 2), 10);
  const minutes = Number.parseInt(padded.substring(2, 4), 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
  return hours * 60 + minutes;
}

export function shiftDurationMinutes(inToken: string, outToken: string): number {
  const inMinutes = minutesFromTimeToken(inToken);
  const outMinutes = minutesFromTimeToken(outToken);
  if (inMinutes < 0 || outMinutes < 0) return 0;
  const diff = outMinutes - inMinutes;
  return diff > 0 ? diff : 0;
}

/** True once the calendar day has passed 11:59 PM local time (or the day is entirely in the past). */
export function shouldAutoLogoutForDay(dayDate: Date, now: Date): boolean {
  const dayStart = startOfDay(dayDate);
  const todayStart = startOfDay(now);
  if (dayStart.getTime() < todayStart.getTime()) return true;
  if (dayStart.getTime() > todayStart.getTime()) return false;
  const cutoff = new Date(dayDate);
  cutoff.setHours(23, 59, 0, 0);
  return now.getTime() >= cutoff.getTime();
}

/**
 * A single punch at/after (shift out minus 60 min) is a clock-out.
 * He forgot to clock in — fill IN from the expected shift start.
 */
export function isLateClockOutPunch(
  punchToken: string,
  shiftProfile: RfidEmployeeShiftProfile = defaultShiftProfile(),
): boolean {
  const punchMin = minutesFromTimeToken(punchToken);
  if (punchMin < 0) return false;
  const shiftOutMin = minutesFromTimeToken(shiftProfile.shiftOut || RFID_DEFAULT_SHIFT_OUT);
  const scheduledOut = shiftOutMin < 0 ? 14 * 60 + 30 : shiftOutMin;
  return punchMin >= Math.max(0, scheduledOut - RFID_LATE_OUT_LOOKBACK_MINUTES);
}

function breakForShift(
  inToken: string,
  outToken: string,
  profile: RfidEmployeeShiftProfile,
): string {
  const duration = shiftDurationMinutes(inToken, outToken);
  if (duration <= RFID_MIN_SHIFT_FOR_BREAK_MINUTES) return '0';
  return String(profile.breakMinutes ?? RFID_DEFAULT_BREAK_MINUTES);
}

/** Build clock rows from raw scans for one employee and pay period. */
export function buildRfidDayClocks(
  scans: RfidScanRecord[],
  employee: RfidEmployeeIdentity,
  period: PayPeriod,
  shiftProfile: RfidEmployeeShiftProfile = defaultShiftProfile(),
  now: Date = new Date(),
): Record<string, RfidDayClock> {
  const days = periodDays(period);
  const dayDates = getPayPeriodDayDates(period);
  const dateKeys = dayDates.map((d) => localDateKey(d));
  const scansByDateKey = new Map<string, Date[]>();

  for (const key of dateKeys) {
    scansByDateKey.set(key, []);
  }

  const periodStart = startOfDay(period.start).getTime();
  const periodEnd = addDays(startOfDay(period.end), 1).getTime();

  for (const scan of scans) {
    if (!scanMatchesEmployee(scan, employee)) continue;
    const at = new Date(scan.scannedAt);
    if (Number.isNaN(at.getTime())) continue;
    const ms = at.getTime();
    if (ms < periodStart || ms >= periodEnd) continue;

    const key = localDateKey(at);
    if (!scansByDateKey.has(key)) continue;
    scansByDateKey.get(key)!.push(at);
  }

  const result: Record<string, RfidDayClock> = {};

  days.forEach((day, index) => {
    const dayDate = dayDates[index];
    const key = dateKeys[index];
    const raw = (scansByDateKey.get(key) || []).sort((a, b) => a.getTime() - b.getTime());
    const deduped = dedupeScanTimes(raw);
    const clock = clockFromScanTimes(deduped);
    let inToken = clock.in;
    let outToken = clock.out;
    let note = '';
    let autoLogout = false;
    let autoLogin = false;
    const expectedIn = shiftProfile.shiftIn || RFID_DEFAULT_SHIFT_IN;
    const expectedOut = shiftProfile.shiftOut || RFID_DEFAULT_SHIFT_OUT;

    if (inToken !== '0' && outToken === '0') {
      if (isLateClockOutPunch(inToken, shiftProfile)) {
        // Lone late punch = clock-out. He forgot to clock in.
        outToken = inToken;
        inToken = expectedIn;
        note = AUTO_LOGIN_NOTE;
        autoLogin = true;
      } else if (shouldAutoLogoutForDay(dayDate, now)) {
        if (minutesFromTimeToken(expectedOut) > minutesFromTimeToken(inToken)) {
          outToken = expectedOut;
          note = AUTO_LOGOUT_NOTE;
          autoLogout = true;
        } else {
          // Auto-out would land before the punch (0.00 hrs). Treat punch as out instead.
          outToken = inToken;
          inToken = expectedIn;
          note = AUTO_LOGIN_NOTE;
          autoLogin = true;
        }
      }
    }

    result[day] = {
      in: inToken,
      out: outToken,
      breaks: breakForShift(inToken, outToken, shiftProfile),
      scanCount: deduped.length,
      note,
      autoLogout,
      autoLogin,
    };
  });

  return result;
}

/** Weekend days in the Fri–Thu pay week — no scheduled shift by default. */
export const PAY_PERIOD_WEEKEND_DAYS = ['Saturday', 'Sunday'] as const;

export function isPayPeriodWorkday(day: string): boolean {
  return !PAY_PERIOD_WEEKEND_DAYS.includes(day as (typeof PAY_PERIOD_WEEKEND_DAYS)[number]);
}

export function sanitizeManualByDay(
  manual: Record<string, RfidManualDayFlags>,
  savedWorkHours: Array<{ day: string; in: string; out: string; breaks: string; note?: string }>,
): Record<string, RfidManualDayFlags> {
  const savedByDay = Object.fromEntries(savedWorkHours.map((r) => [r.day, r]));
  const result: Record<string, RfidManualDayFlags> = {};

  for (const [day, flags] of Object.entries(manual || {})) {
    const saved = savedByDay[day];
    if (!saved) continue;
    const cleaned: RfidManualDayFlags = {};
    // Keep explicit Edit locks, including a manual zero that clears a bad RFID day.
    if (flags.in) cleaned.in = true;
    if (flags.out) cleaned.out = true;
    if (flags.breaks) cleaned.breaks = true;
    if (flags.note) cleaned.note = true;
    if (Object.keys(cleaned).length > 0) result[day] = cleaned;
  }

  return result;
}

export function inferManualFromSavedRows(
  rows: Array<{ day: string; in: string; out: string; breaks: string; note?: string }>,
  rfidByDay: Record<string, RfidDayClock>,
  existingManual: Record<string, RfidManualDayFlags> = {},
): Record<string, RfidManualDayFlags> {
  // Do not invent locks from stale saved clocks vs live RFID.
  void rows;
  void rfidByDay;
  return { ...existingManual };
}

/** Drop manual locks for days that have RFID scans — scans are the live source of truth. */
function applyRfidPreferenceToManual(
  manual: Record<string, RfidManualDayFlags>,
  rfidByDay: Record<string, RfidDayClock>,
  preferRfidWhenScansExist: boolean,
): Record<string, RfidManualDayFlags> {
  // Disabled: explicit Edit saves must stick. RFID only fills unlocked fields.
  void rfidByDay;
  void preferRfidWhenScansExist;
  return manual;
}

/** RFID scans + optional manual overrides — never treat blank DB rows as overrides. */
export function buildTimesheetRowsFromScans(
  period: PayPeriod,
  scanList: RfidScanRecord[],
  employee: RfidEmployeeIdentity,
  profile: RfidEmployeeShiftProfile,
  savedManual: Record<string, RfidManualDayFlags>,
  savedWorkHours: Array<{ day: string; in: string; out: string; breaks: string; note?: string }> = [],
  preferRfidWhenScansExist = false,
): { rows: Array<RfidDayClock & { day: string; dateLabel: string }>; manual: Record<string, RfidManualDayFlags> } {
  const days = periodDays(period);
  const dates = getPayPeriodDayDates(period).map((d) => formatPayPeriodDayHeader(d));
  const baseRows = days.map((day, index) => ({
    day,
    dateLabel: dates[index] || day,
    in: '0',
    out: '0',
    breaks: '0',
    scanCount: 0,
    note: '',
    autoLogout: false,
    autoLogin: false,
  }));
  const rfidByDay = buildRfidDayClocks(scanList, employee, period, profile);
  const savedByDay = Object.fromEntries(savedWorkHours.map((r) => [r.day, r]));
  let manual = sanitizeManualByDay(savedManual, savedWorkHours);
  manual = inferManualFromSavedRows(savedWorkHours, rfidByDay, manual);
  manual = sanitizeManualByDay(manual, savedWorkHours);
  manual = applyRfidPreferenceToManual(manual, rfidByDay, preferRfidWhenScansExist);

  let merged = mergeRfidIntoWorkHours(baseRows, rfidByDay, manual);
  merged = merged.map((row) => {
    const flags = manual[row.day];
    const saved = savedByDay[row.day];
    if (!flags || !saved) return row;
    return {
      ...row,
      in: flags.in ? String(saved.in) : row.in,
      out: flags.out ? String(saved.out) : row.out,
      breaks: flags.breaks ? String(saved.breaks) : row.breaks,
      note: flags.note ? String(saved.note ?? '') : row.note,
    };
  });

  return { rows: merged, manual };
}

export function mergeRfidIntoWorkHours<
  T extends {
    day: string;
    in: string;
    out: string;
    breaks: string;
    scanCount: number;
    note?: string;
    autoLogout?: boolean;
    autoLogin?: boolean;
  },
>(
  rows: T[],
  rfidByDay: Record<string, RfidDayClock>,
  manualByDay: Record<string, RfidManualDayFlags>,
): T[] {
  return rows.map((row) => {
    const rfid = rfidByDay[row.day];
    if (!rfid) return row;
    const manual = manualByDay[row.day] || {};
    const next = { ...row };
    if (!manual.in) next.in = rfid.in;
    if (!manual.out) next.out = rfid.out;
    if (!manual.breaks) next.breaks = rfid.breaks;
    if (!manual.note) {
      next.note = rfid.note;
      next.autoLogout = rfid.autoLogout;
      next.autoLogin = rfid.autoLogin;
    }
    next.scanCount = rfid.scanCount;
    return next;
  });
}

export function payPeriodScanRangeIso(period: PayPeriod): { from: string; to: string } {
  const from = startOfDay(period.start).toISOString();
  const to = addDays(startOfDay(period.end), 1).toISOString();
  return { from, to };
}

export type RfidTimesheetWeekPayload = {
  workHours: Array<{
    day: string;
    in: string;
    out: string;
    breaks: string;
    scanCount: number;
    note?: string;
  }>;
  receipts: Array<{ description: string; amount: string }>;
  additionalHours: Array<{ id: string; description: string; hours: string }>;
  travelMiles: Array<{ day: string; miles: string }>;
  ratePerHour: string;
  manualByDay: Record<string, RfidManualDayFlags>;
};

export function profileMapFromApi(
  profiles: Array<{
    employeeKey: string;
    shiftIn?: string;
    shiftOut?: string;
    breakMinutes?: number;
    ratePerHour?: string;
  }>,
): Record<string, RfidEmployeeShiftProfile> {
  const map: Record<string, RfidEmployeeShiftProfile> = {};
  for (const profile of profiles) {
    const key = normalizeEmployeeKey(profile.employeeKey);
    if (!key) continue;
    map[key] = {
      shiftIn: profile.shiftIn || RFID_DEFAULT_SHIFT_IN,
      shiftOut: profile.shiftOut || RFID_DEFAULT_SHIFT_OUT,
      breakMinutes: Number(profile.breakMinutes ?? RFID_DEFAULT_BREAK_MINUTES) || 0,
      ratePerHour: String(profile.ratePerHour ?? ''),
    };
  }
  return map;
}
