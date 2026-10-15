import { addDays, format, startOfDay, subDays } from 'date-fns';

/** Shop default: Friday → Thursday; paycheck on the following Friday. */
export const PAY_PERIOD_DAYS = [
  'Friday',
  'Saturday',
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
] as const;

/** Daniel only: Monday → Sunday; hours tracked Mon–Fri. */
export const DANIEL_PAY_PERIOD_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export type PayPeriodDay = (typeof PAY_PERIOD_DAYS)[number] | (typeof DANIEL_PAY_PERIOD_DAYS)[number];

export type PayCalendarId = 'fri-thu' | 'mon-sun';

export type PayCalendar = {
  id: PayCalendarId;
  /** `Date#getDay()` of the first day in the week */
  weekStartDay: number;
  days: readonly string[];
  payDateOffsetDays: number;
};

export const SHOP_PAY_CALENDAR: PayCalendar = {
  id: 'fri-thu',
  weekStartDay: 5,
  days: PAY_PERIOD_DAYS,
  payDateOffsetDays: 7,
};

export const DANIEL_PAY_CALENDAR: PayCalendar = {
  id: 'mon-sun',
  weekStartDay: 1,
  days: DANIEL_PAY_PERIOD_DAYS,
  payDateOffsetDays: 7,
};

export type PayPeriod = {
  /** First day of the work week */
  start: Date;
  /** Last day of the work week */
  end: Date;
  /** Payday — the same weekday as week start, after the work week */
  payDate: Date;
  label: string;
  /** yyyy-MM-dd of period start (stable key) */
  id: string;
  days: readonly string[];
  calendarId: PayCalendarId;
};

export function normalizeEmployeeKey(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isDanielEmployee(nameOrKey?: string | null): boolean {
  const key = normalizeEmployeeKey(nameOrKey || '');
  return key === 'daniel' || key.startsWith('daniel ');
}

export function getPayCalendarById(id?: PayCalendarId | string | null): PayCalendar {
  return id === DANIEL_PAY_CALENDAR.id ? DANIEL_PAY_CALENDAR : SHOP_PAY_CALENDAR;
}

export function getPayCalendarForEmployee(employeeKey?: string | null): PayCalendar {
  return isDanielEmployee(employeeKey) ? DANIEL_PAY_CALENDAR : SHOP_PAY_CALENDAR;
}

export function periodDays(period: Pick<PayPeriod, 'days'> | null | undefined): readonly string[] {
  return period?.days?.length ? period.days : PAY_PERIOD_DAYS;
}

function buildPayPeriod(start: Date, calendar: PayCalendar): PayPeriod {
  const periodStart = startOfDay(start);
  const periodEnd = addDays(periodStart, 6);
  const payDate = addDays(periodStart, calendar.payDateOffsetDays);
  return {
    start: periodStart,
    end: periodEnd,
    payDate,
    label: `${format(periodStart, 'MMM d')} – ${format(periodEnd, 'MMM d, yyyy')}`,
    id: format(periodStart, 'yyyy-MM-dd'),
    days: calendar.days,
    calendarId: calendar.id,
  };
}

/** Return the pay period that contains `date` on this calendar. */
export function getPayPeriodForDate(
  date: Date,
  calendar: PayCalendar = SHOP_PAY_CALENDAR,
): PayPeriod {
  const d = startOfDay(date);
  const delta = (d.getDay() - calendar.weekStartDay + 7) % 7;
  return buildPayPeriod(subDays(d, delta), calendar);
}

export function shiftPayPeriod(period: PayPeriod, weekDelta: number): PayPeriod {
  return buildPayPeriod(addDays(period.start, weekDelta * 7), getPayCalendarById(period.calendarId));
}

/** Calendar date for each day slot in the pay period. */
export function getPayPeriodDayDates(period: PayPeriod): Date[] {
  return periodDays(period).map((_, index) => addDays(period.start, index));
}

export function formatPayPeriodDayHeader(date: Date): string {
  return format(date, 'EEE, MMM d');
}

export function formatPayDate(date: Date): string {
  return format(date, 'EEE, MMM d, yyyy');
}

/** True when `period` is the pay week that contains today. */
export function isCurrentPayPeriod(period: PayPeriod, anchor: Date = new Date()): boolean {
  return period.id === getPayPeriodForDate(anchor, getPayCalendarById(period.calendarId)).id;
}

/** True once payday for this period has ended — then the sheet locks. */
export function isPastPayPeriod(period: PayPeriod, anchor: Date = new Date()): boolean {
  return startOfDay(anchor).getTime() > startOfDay(period.payDate).getTime();
}

/** Current work week, plus the week being paid (editable through payday). */
export function isEditablePayPeriod(period: PayPeriod, anchor: Date = new Date()): boolean {
  if (isPastPayPeriod(period, anchor)) return false;
  return startOfDay(period.start).getTime() <= startOfDay(anchor).getTime();
}

/**
 * Kept for call-site compatibility. Manual Edit locks always stick;
 * RFID only fills fields that were not manually edited.
 */
export function shouldPreferRfidOverManual(
  _period: PayPeriod,
  _isEditMode: boolean,
  _anchor: Date = new Date(),
): boolean {
  return false;
}

/** Recent pay periods for dropdowns (current week first). */
export function listRecentPayPeriods(
  anchor: Date,
  count = 12,
  calendar: PayCalendar = SHOP_PAY_CALENDAR,
): PayPeriod[] {
  const current = getPayPeriodForDate(anchor, calendar);
  const periods: PayPeriod[] = [];
  for (let i = 0; i < count; i += 1) {
    periods.push(shiftPayPeriod(current, -i));
  }
  return periods;
}
