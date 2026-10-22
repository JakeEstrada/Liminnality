import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

export const CALENDAR_MONTHS_PRINT_STORAGE_KEY = 'paarth.calendar-months.print';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_EVENT_COLOR = '#1976D2';

export type CalendarMonthsPrintEvent = {
  label: string;
  installer: string;
  color: string;
};

export type CalendarMonthsPrintDay = {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  holiday: string;
  events: CalendarMonthsPrintEvent[];
};

export type CalendarMonthsPrintMonth = {
  title: string;
  weekdayLabels: string[];
  columnCount: number;
  days: CalendarMonthsPrintDay[];
};

export type CalendarMonthsPrintData = {
  printedAt: string;
  rangeLabel: string;
  months: CalendarMonthsPrintMonth[];
};

type PrintableEvent = {
  title?: string;
  color?: string;
  job?: {
    title?: string;
    customerId?: { name?: string } | string;
  };
  schedule?: {
    title?: string;
    installer?: string;
    startDate?: string | Date;
    endDate?: string | Date;
  };
};

function calendarDaysForMonth(monthDate: Date) {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  return eachDayOfInterval({
    start: startOfWeek(monthStart),
    end: endOfWeek(monthEnd),
  });
}

function eventLabel(event: PrintableEvent) {
  const customer =
    event.job?.customerId && typeof event.job.customerId === 'object'
      ? String(event.job.customerId.name || '').trim()
      : '';
  const title = String(event.schedule?.title || event.title || event.job?.title || '').trim();
  return customer || title || 'Job';
}

function eventsOnDate(events: PrintableEvent[], date: Date) {
  const dateStr = format(date, 'yyyy-MM-dd');
  return (events || []).filter((event) => {
    if (!event.schedule?.startDate) return false;
    const startStr = format(new Date(event.schedule.startDate), 'yyyy-MM-dd');
    const endStr = format(new Date(event.schedule.endDate || event.schedule.startDate), 'yyyy-MM-dd');
    return dateStr >= startStr && dateStr <= endStr;
  });
}

function buildMonth(
  monthDate: Date,
  events: PrintableEvent[],
  holidayMap: Record<string, string>,
  hiddenWeekdays: number[],
): CalendarMonthsPrintMonth {
  const hidden = new Set(hiddenWeekdays);
  const weekdayLabels = WEEKDAY_SHORT.filter((_, index) => !hidden.has(index));
  const days = calendarDaysForMonth(monthDate)
    .filter((date) => !hidden.has(date.getDay()))
    .map((date) => {
      const iso = format(date, 'yyyy-MM-dd');
      return {
        iso,
        day: date.getDate(),
        inMonth: isSameMonth(date, monthDate),
        isToday: isToday(date),
        holiday: holidayMap[iso] || '',
        events: eventsOnDate(events, date).map((event) => ({
          label: eventLabel(event),
          installer: String(event.schedule?.installer || '').trim(),
          color: event.color || DEFAULT_EVENT_COLOR,
        })),
      };
    });

  return {
    title: format(monthDate, 'MMMM yyyy'),
    weekdayLabels,
    columnCount: weekdayLabels.length,
    days,
  };
}

export function buildCalendarMonthsPrintData({
  currentDate,
  events,
  holidayMap = {},
  hiddenWeekdays = [],
}: {
  currentDate: Date;
  events: PrintableEvent[];
  holidayMap?: Record<string, string>;
  hiddenWeekdays?: number[];
}): CalendarMonthsPrintData {
  const thisMonth = startOfMonth(currentDate);
  const nextMonth = addMonths(thisMonth, 1);
  const months = [
    buildMonth(thisMonth, events, holidayMap, hiddenWeekdays),
    buildMonth(nextMonth, events, holidayMap, hiddenWeekdays),
  ];

  return {
    printedAt: format(new Date(), 'EEE, MMM d, yyyy'),
    rangeLabel: `${months[0].title} – ${months[1].title}`,
    months,
  };
}

export function writeCalendarMonthsPrintData(data: CalendarMonthsPrintData) {
  const json = JSON.stringify(data);
  sessionStorage.setItem(CALENDAR_MONTHS_PRINT_STORAGE_KEY, json);
  localStorage.setItem(CALENDAR_MONTHS_PRINT_STORAGE_KEY, json);
}

export function readCalendarMonthsPrintData(): CalendarMonthsPrintData | null {
  const raw =
    sessionStorage.getItem(CALENDAR_MONTHS_PRINT_STORAGE_KEY) ||
    localStorage.getItem(CALENDAR_MONTHS_PRINT_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CalendarMonthsPrintData;
  } catch {
    return null;
  }
}
