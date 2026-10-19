import { format } from 'date-fns';
import { jobSiteAddress } from './jobGeo';
import {
  formatMoney,
  getContractBase,
  getJobPaymentSummary,
  getScheduleItemTotal,
  inferDueTypeFromLabel,
  matchesStandard4060Template,
  resolvePaymentScheduleForCommission,
  sumChangeOrdersForFinal,
} from './paymentSchedule';

export const CALENDAR_BENCH_PRINT_STORAGE_KEY = 'paarth.calendar-bench.print';

export type CalendarBenchPrintRow = {
  jobTitle: string;
  customerName: string;
  address: string;
  depositDate: string;
  scheduleShort: string;
  scheduleDetail: string;
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

function formatPaymentStructure(job: Record<string, unknown>, hideSensitive: boolean) {
  const schedule = resolvePaymentScheduleForCommission(job);
  const items = schedule.items || [];
  if (!items.length) {
    return { short: '—', detail: '' };
  }
  const is4060 =
    schedule.type === 'standard_40_60' ||
    matchesStandard4060Template(items) ||
    (items.length === 2 && Number(items[0]?.percentage) === 40 && Number(items[1]?.percentage) === 60);

  if (is4060) {
    return { short: '40 / 60', detail: 'Deposit 40% · Final 60%' };
  }

  const contractBase = getContractBase(job);
  const coAddedToFinal = sumChangeOrdersForFinal(job);
  const percents = items.map((item) => Number(item.percentage));
  const allPercents = percents.every((n) => Number.isFinite(n) && n > 0);
  const short = allPercents ? percents.map((n) => String(n)).join(' / ') : `${items.length} payments`;
  const detail = items
    .map((item) => {
      const label = String(item.label || 'Payment').trim() || 'Payment';
      const pct = Number(item.percentage);
      if (Number.isFinite(pct) && pct > 0) return `${label} ${pct}%`;
      const amount = getScheduleItemTotal(item, contractBase, coAddedToFinal);
      return hideSensitive ? label : `${label} ${formatMoney(amount)}`;
    })
    .join(' · ');
  return { short, detail };
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
      const structure = formatPaymentStructure(job, hideSensitive);
      return {
        jobTitle: String(job?.title || 'Untitled job').trim() || 'Untitled job',
        customerName: customer || 'Unknown',
        address: jobSiteAddress(job),
        depositDate: deposit?.dateLabel || '',
        scheduleShort: structure.short,
        scheduleDetail: structure.detail,
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
