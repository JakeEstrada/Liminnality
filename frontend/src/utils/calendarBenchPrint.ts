import { format } from 'date-fns';
import {
  formatMoney,
  getJobPaymentSummary,
  inferDueTypeFromLabel,
  resolvePaymentScheduleForCommission,
} from './paymentSchedule';

export const CALENDAR_BENCH_PRINT_STORAGE_KEY = 'paarth.calendar-bench.print';

export type CalendarBenchPrintRow = {
  jobTitle: string;
  customerName: string;
  depositDate: string;
  payments: string;
  lastPaymentDate: string;
  total: string;
};

export type CalendarBenchPrintData = {
  printedAt: string;
  hideSensitive: boolean;
  rows: CalendarBenchPrintRow[];
};

function formatSheetDate(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'M/d/yyyy');
}

function paidItems(job: Record<string, unknown>) {
  const schedule = resolvePaymentScheduleForCommission(job);
  return (schedule.items || [])
    .filter((item) => item?.status === 'paid')
    .map((item) => {
      const due = item.dueType || inferDueTypeFromLabel(item.label);
      return {
        label: String(item.label || (due === 'deposit' ? 'Deposit' : 'Payment')).trim() || 'Payment',
        dueType: due,
        paidAt: item.paidAt || null,
        dateLabel: formatSheetDate(item.paidAt),
      };
    });
}

export function buildCalendarBenchPrintData(
  jobs: Array<Record<string, unknown>> = [],
  { hideSensitive = false }: { hideSensitive?: boolean } = {},
): CalendarBenchPrintData {
  const rows = [...jobs]
    .sort((a, b) => {
      const customerA = String(
        (a?.customerId && typeof a.customerId === 'object' && (a.customerId as { name?: string }).name) ||
          a?.title ||
          '',
      );
      const customerB = String(
        (b?.customerId && typeof b.customerId === 'object' && (b.customerId as { name?: string }).name) ||
          b?.title ||
          '',
      );
      const byCustomer = customerA.localeCompare(customerB, undefined, { sensitivity: 'base' });
      if (byCustomer !== 0) return byCustomer;
      return String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
    })
    .map((job) => {
      const customer =
        job?.customerId && typeof job.customerId === 'object'
          ? String((job.customerId as { name?: string }).name || '').trim()
          : '';
      const paid = paidItems(job);
      const deposit = paid.find((item) => item.dueType === 'deposit');
      const lastPaid = [...paid].reverse().find((item) => item.dateLabel) || paid[paid.length - 1];
      const summary = getJobPaymentSummary(job);
      return {
        jobTitle: String(job?.title || 'Untitled job').trim() || 'Untitled job',
        customerName: customer || 'Unknown',
        depositDate: deposit?.dateLabel || '',
        payments: paid.length
          ? paid.map((item) => (item.dateLabel ? `${item.label} ${item.dateLabel}` : item.label)).join(' · ')
          : '',
        lastPaymentDate: lastPaid?.dateLabel || '',
        total: hideSensitive ? 'Locked' : formatMoney(summary.jobTotal),
      };
    });

  return {
    printedAt: format(new Date(), 'EEE, MMM d, yyyy'),
    hideSensitive,
    rows,
  };
}

export function writeCalendarBenchPrintData(data: CalendarBenchPrintData) {
  const json = JSON.stringify(data);
  sessionStorage.setItem(CALENDAR_BENCH_PRINT_STORAGE_KEY, json);
  localStorage.setItem(CALENDAR_BENCH_PRINT_STORAGE_KEY, json);
}

export function readCalendarBenchPrintData(): CalendarBenchPrintData | null {
  const raw =
    sessionStorage.getItem(CALENDAR_BENCH_PRINT_STORAGE_KEY) ||
    localStorage.getItem(CALENDAR_BENCH_PRINT_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CalendarBenchPrintData;
  } catch {
    return null;
  }
}
