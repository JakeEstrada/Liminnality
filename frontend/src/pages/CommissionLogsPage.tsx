/**
 * CommissionLogsPage — Sales commission logs.
 * Route: /commission-logs
 * Docs: ../../../docs/PAGES.md#commissionlogspagetsx
 */
import { useCallback, useEffect, useMemo, useRef, useState, Fragment, type CSSProperties, type MouseEvent } from 'react';
import {
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Collapse,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import CloseIcon from '@mui/icons-material/Close';
import PersonIcon from '@mui/icons-material/Person';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import axios, { isAxiosError } from 'axios';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { getCommissionPaymentSplits, getJobTotalWithChangeOrders, formatMoney, formatMoneyInput, roundMoney } from '../utils/paymentSchedule';
import { isCommissionEligibleJob } from '../utils/commissionJobEligibility';
import { useAuth } from '../context/AuthContext';
import { useTenantRealtimeRefresh } from '../hooks/useSocketSubscription';
import { useIsMobile } from '../hooks/useIsMobile';
import { getTenantRoom } from '../services/socket';
import JobDetailModal from '../components/jobs/JobDetailModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const COMMISSION_LOGS_STORAGE_KEY = 'financeHubCommissionLogsRows';
const DEFAULT_COMMISSION_RATE_KEY = 'financeHubCommissionDefaultRate';
const COMMISSION_INHERITED_RATES_KEY = 'financeHubCommissionInheritedRates';
const COMMISSION_OVERVIEW_JOB_ORDER_KEY = 'financeHubCommissionOverviewJobOrder';
const COMMISSION_SHOW_ZERO_RATE_KEY = 'financeHubCommissionShowZeroRate';
const COMMISSION_PAGE_TAB_KEY = 'financeHubCommissionPageTab';
const DEFAULT_COMMISSION_RATE = 13;

type CommissionPageTab = 'jobs' | 'recent' | 'checks';

const ESTIMATE_STAGE_LABELS: Record<string, string> = {
  APPOINTMENT_SCHEDULED: 'Appointment',
  ESTIMATE_IN_PROGRESS: 'Estimate current',
  ESTIMATE_SENT: 'Estimate sent',
  ENGAGED_DESIGN_REVIEW: 'Design review',
  CONTRACT_OUT: 'Contract out',
  CONTRACT_SIGNED: 'Contract signed',
  DEPOSIT_PENDING: 'Deposit pending',
  JOB_PREP: 'Job prep',
  TAKEOFF_COMPLETE: 'Fabrication',
  READY_TO_SCHEDULE: 'Ready to schedule',
  SCHEDULED: 'Scheduled',
  IN_PRODUCTION: 'In production',
  INSTALLED: 'Installed',
  FINAL_PAYMENT_CLOSED: 'Final payment closed',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

function jobTitleAfterPipe(rawTitle: unknown): string {
  const t = String(rawTitle || '').trim();
  if (!t) return 'Untitled';
  const i = t.indexOf('|');
  if (i >= 0) {
    const tail = t.slice(i + 1).trim();
    return tail || t;
  }
  return t;
}

/** Prefer contracted/estimated job values; ignore zero-dollar estimate drafts. Includes change orders. */
function resolveCommissionJobTotal(job: JobDoc, estimate?: EstimateDoc): number {
  let base = 0;

  const contracted = Number(job?.valueContracted);
  if (Number.isFinite(contracted) && contracted > 0) base = roundMoney(contracted);
  else {
    const estimated = Number(job?.valueEstimated);
    if (Number.isFinite(estimated) && estimated > 0) base = roundMoney(estimated);
    else {
      const estimateTotal = Number(estimate?.grandTotal);
      if (Number.isFinite(estimateTotal) && estimateTotal > 0) base = roundMoney(estimateTotal);
    }
  }

  if (base <= 0) {
    const scheduleItems = job?.paymentSchedule?.items;
    if (Array.isArray(scheduleItems) && scheduleItems.length > 0) {
      let scheduleSum = 0;
      for (const item of scheduleItems) {
        const paid = Number(item.paidAmount);
        const fixed = Number(item.amount);
        if (Number.isFinite(paid) && paid > 0) scheduleSum += paid;
        else if (Number.isFinite(fixed) && fixed > 0) scheduleSum += fixed;
      }
      if (scheduleSum > 0) base = roundMoney(scheduleSum);
    }
  }

  if (base <= 0) {
    const deposit = Number(job?.contract?.depositReceived);
    const finalPaid = Number(job?.finalPayment?.amountPaid);
    const legacyTotal =
      (Number.isFinite(deposit) && deposit > 0 ? deposit : 0) +
      (Number.isFinite(finalPaid) && finalPaid > 0 ? finalPaid : 0);
    if (legacyTotal > 0) base = roundMoney(legacyTotal);
  }

  return getJobTotalWithChangeOrders({
    ...job,
    valueContracted: base,
    valueEstimated: base,
  });
}

function pickLatestPositiveEstimateByJob(estimates: EstimateDoc[]): Map<string, EstimateDoc> {
  const latestEstimateByJob = new Map<string, EstimateDoc>();
  for (const est of estimates) {
    const jid = est?.jobId;
    const jobIdRaw = typeof jid === 'object' && jid !== null ? jid._id : jid;
    const jobId = String(jobIdRaw || '');
    if (!jobId) continue;

    const grandTotal = Number(est?.grandTotal) || 0;
    if (grandTotal <= 0) continue;

    const prev = latestEstimateByJob.get(jobId);
    const estTime = new Date(est?.createdAt || 0).getTime();
    const prevTime = prev ? new Date(prev?.createdAt || 0).getTime() : -1;
    if (!prev || estTime > prevTime) latestEstimateByJob.set(jobId, est);
  }
  return latestEstimateByJob;
}

function toDateInputValue(value: unknown): string {
  if (!value) return '';
  try {
    return format(new Date(String(value)), 'yyyy-MM-dd');
  } catch {
    return '';
  }
}

function parsePositiveCommissionRate(value: unknown): number | null {
  const n = Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function formatCommissionRateLabel(rate: number): string {
  if (!Number.isFinite(rate)) return '—';
  const rounded = Math.round(rate * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${text}%`;
}

function readDefaultCommissionRate(): number {
  if (typeof window === 'undefined') return DEFAULT_COMMISSION_RATE;
  try {
    const parsed = parsePositiveCommissionRate(window.localStorage.getItem(DEFAULT_COMMISSION_RATE_KEY));
    return parsed ?? DEFAULT_COMMISSION_RATE;
  } catch {
    return DEFAULT_COMMISSION_RATE;
  }
}

function readInheritedCommissionRates(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(COMMISSION_INHERITED_RATES_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const next: Record<string, number> = {};
    for (const [jobId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const rate = parsePositiveCommissionRate(value);
      if (rate != null) next[jobId] = rate;
    }
    return next;
  } catch {
    return {};
  }
}

function readOverviewJobOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(COMMISSION_OVERVIEW_JOB_ORDER_KEY);
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readShowZeroCommissionJobs(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COMMISSION_SHOW_ZERO_RATE_KEY) === 'true';
  } catch {
    return false;
  }
}

function readCommissionPageTab(): CommissionPageTab {
  if (typeof window === 'undefined') return 'checks';
  try {
    const stored = window.localStorage.getItem(COMMISSION_PAGE_TAB_KEY);
    if (stored === 'jobs' || stored === 'recent') return stored;
    return 'checks';
  } catch {
    return 'checks';
  }
}

function parseDateSortValue(value: string): number {
  if (!value) return 0;
  const time = new Date(`${value}T12:00:00`).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Matches the `md` breakpoint behind useIsMobile(), for helpers that run outside components. */
function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 899.95px)').matches;
}

function formatCheckDisplayDate(value: string): string {
  if (!value) return '—';
  try {
    // Phones get the numeric form so date columns don't force sideways scrolling.
    return format(new Date(`${value}T12:00:00`), isMobileViewport() ? 'MM/dd/yyyy' : 'MMM dd, yyyy');
  } catch {
    return value;
  }
}

interface CommissionCheckEntry {
  jobId: string;
  customerName: string;
  jobLabel: string;
  paymentLabel: string;
  depositedAmount: number;
  amount: number;
  check: string;
  date: string;
  customerPaidDate: string;
  salesmanPaid: boolean;
  entryKind: 'payment' | 'adjustment';
  scheduleIndex?: number;
  adjustmentId?: string;
}

interface SalesmanPaidEntry {
  jobId: string;
  customerName: string;
  jobLabel: string;
  paymentLabel: string;
  customerPaidAmount: number | null;
  amount: number;
  date: string;
  check: string;
  balance: number;
}

interface CommissionCheckGroup {
  id: string;
  checkKey: string;
  checkDisplay: string;
  isCash: boolean;
  date: string;
  totalAmount: number;
  entries: CommissionCheckEntry[];
}

function normalizeCheckKey(check: string): string {
  const trimmed = String(check || '').trim();
  if (!trimmed) return '__none__';
  if (/^cash$/i.test(trimmed)) return '__cash__';
  return trimmed;
}

function getCheckDisplayLabel(checkKey: string, rawCheck: string): string {
  if (checkKey === '__cash__') return 'Cash';
  if (checkKey === '__none__') return 'No check #';
  return rawCheck || checkKey;
}

function groupCheckEntries(entries: CommissionCheckEntry[]): CommissionCheckGroup[] {
  const map = new Map<string, CommissionCheckGroup>();

  for (const entry of entries) {
    const checkKey = normalizeCheckKey(entry.check);
    let group = map.get(checkKey);
    if (!group) {
      group = {
        id: checkKey,
        checkKey,
        checkDisplay: getCheckDisplayLabel(checkKey, entry.check),
        isCash: checkKey === '__cash__',
        date: entry.date,
        totalAmount: 0,
        entries: [],
      };
      map.set(checkKey, group);
    }

    group.entries.push(entry);
    group.totalAmount = roundMoney(group.totalAmount + entry.amount);
    if (parseDateSortValue(entry.date) > parseDateSortValue(group.date)) {
      group.date = entry.date;
    }
  }

  for (const group of map.values()) {
    group.entries.sort((a, b) => {
      const dateDiff = parseDateSortValue(b.date) - parseDateSortValue(a.date);
      if (dateDiff !== 0) return dateDiff;
      return String(a.customerName || '').localeCompare(String(b.customerName || ''));
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    const dateDiff = parseDateSortValue(b.date) - parseDateSortValue(a.date);
    if (dateDiff !== 0) return dateDiff;
    return a.checkDisplay.localeCompare(b.checkDisplay);
  });
}

function buildSalesmanPaidEntries(rows: CommissionTableRow[]): SalesmanPaidEntry[] {
  const entries: SalesmanPaidEntry[] = [];

  for (const row of rows) {
    for (const payment of row.payments) {
      if (!payment.salesmanPaid) continue;

      const amount =
        payment.amount > 0
          ? payment.amount
          : payment.potentialAmount > 0
            ? payment.potentialAmount
            : 0;
      if (amount <= 0) continue;

      entries.push({
        jobId: row.jobId,
        customerName: row.customerName,
        jobLabel: row.jobLabel,
        paymentLabel: payment.label,
        customerPaidAmount:
          payment.scheduledAmount > 0 ? roundMoney(payment.scheduledAmount) : null,
        amount: roundMoney(amount),
        date: String(payment.date || '').trim(),
        check: String(payment.check || '').trim(),
        balance: row.balance,
      });
    }

    for (const adjustment of row.adjustments) {
      if (adjustment.kind === 'deduction') continue;
      if (!adjustment.salesmanPaid) continue;
      if (Math.abs(adjustment.amount) < 0.005) continue;

      entries.push({
        jobId: row.jobId,
        customerName: row.customerName,
        jobLabel: row.jobLabel,
        paymentLabel: adjustment.label,
        customerPaidAmount: null,
        amount: roundMoney(adjustment.amount),
        date: String(adjustment.date || '').trim(),
        check: String(adjustment.check || '').trim(),
        balance: row.balance,
      });
    }
  }

  return entries.sort((a, b) => {
    const dateDiff = parseDateSortValue(b.date) - parseDateSortValue(a.date);
    if (dateDiff !== 0) return dateDiff;
    return compareCustomerName(
      { customerName: a.customerName } as CommissionTableRow,
      { customerName: b.customerName } as CommissionTableRow,
    );
  });
}

function matchesSalesmanPaidSearch(entry: SalesmanPaidEntry, rawQuery: string): boolean {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return true;

  const qNormalized = q.replace(/[,$]/g, '');
  const haystackParts: unknown[] = [
    entry.customerName,
    entry.jobLabel,
    entry.paymentLabel,
    entry.check,
    entry.date,
    formatCheckDisplayDate(entry.date),
    ...moneySearchTokens(entry.amount),
    ...moneySearchTokens(entry.customerPaidAmount),
    ...moneySearchTokens(entry.balance),
  ];

  const haystack = haystackParts
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
  const haystackNormalized = haystack.replace(/[,$]/g, '');

  if (haystack.includes(q)) return true;
  return qNormalized.length > 0 && haystackNormalized.includes(qNormalized);
}

function buildCheckEntries(rows: CommissionTableRow[]): CommissionCheckEntry[] {
  const entries: CommissionCheckEntry[] = [];

  for (const row of rows) {
    for (const payment of row.payments) {
      const check = String(payment.check || '').trim();
      const date = String(payment.date || '').trim();
      // Only fall back to the scheduled amount once the salesman is marked paid.
      // Otherwise a tier with just a check number typed in inflates the group totals.
      const amount =
        payment.amount > 0
          ? payment.amount
          : payment.salesmanPaid && payment.potentialAmount > 0
            ? payment.potentialAmount
            : 0;

      if (!payment.salesmanPaid && !check && !date) continue;

      entries.push({
        jobId: row.jobId,
        customerName: row.customerName,
        jobLabel: row.jobLabel,
        paymentLabel: payment.label,
        depositedAmount: roundMoney(Number(payment.depositedAmount) || 0),
        amount: roundMoney(amount),
        check,
        date,
        customerPaidDate: String(payment.customerPaidDate || '').trim(),
        salesmanPaid: payment.salesmanPaid,
        entryKind: 'payment',
        scheduleIndex: payment.scheduleIndex,
      });
    }

    for (const adjustment of row.adjustments) {
      if (adjustment.kind === 'deduction') continue;

      const check = String(adjustment.check || '').trim();
      const date = String(adjustment.date || '').trim();
      const amount = adjustment.amount;

      if (!adjustment.salesmanPaid && !check && !date && Math.abs(amount) < 0.005) continue;

      entries.push({
        jobId: row.jobId,
        customerName: row.customerName,
        jobLabel: row.jobLabel,
        paymentLabel: adjustment.label,
        depositedAmount: 0,
        amount: roundMoney(amount),
        check,
        date,
        customerPaidDate: '',
        salesmanPaid: adjustment.salesmanPaid,
        entryKind: 'adjustment',
        adjustmentId: adjustment.id,
      });
    }
  }

  return entries.sort((a, b) => {
    const dateDiff = parseDateSortValue(b.date) - parseDateSortValue(a.date);
    if (dateDiff !== 0) return dateDiff;
    return compareCustomerName(
      { customerName: a.customerName } as CommissionTableRow,
      { customerName: b.customerName } as CommissionTableRow,
    );
  });
}

function matchesCheckSearch(entry: CommissionCheckEntry, rawQuery: string): boolean {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return true;

  const qNormalized = q.replace(/[,$]/g, '');
  const haystackParts: unknown[] = [
    entry.customerName,
    entry.jobLabel,
    entry.paymentLabel,
    entry.check,
    entry.date,
    formatCheckDisplayDate(entry.date),
    entry.customerPaidDate,
    formatCheckDisplayDate(entry.customerPaidDate),
    ...moneySearchTokens(entry.amount),
    ...moneySearchTokens(entry.depositedAmount),
    entry.salesmanPaid ? 'salesman paid' : 'unpaid',
  ];

  const haystack = haystackParts
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
  const haystackNormalized = haystack.replace(/[,$]/g, '');

  if (haystack.includes(q)) return true;
  return qNormalized.length > 0 && haystackNormalized.includes(qNormalized);
}

function matchesCheckGroup(group: CommissionCheckGroup, rawQuery: string): boolean {
  const q = String(rawQuery || '').trim();
  if (!q) return true;

  const groupHaystack = [
    group.checkDisplay,
    group.date,
    formatCheckDisplayDate(group.date),
    String(group.entries.length),
    ...moneySearchTokens(group.totalAmount),
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .join(' ');

  if (groupHaystack.includes(q.toLowerCase())) return true;
  return group.entries.some((entry) => matchesCheckSearch(entry, rawQuery));
}

interface RecentSalesmanPaidTableProps {
  entries: SalesmanPaidEntry[];
  onOpenJob: (jobId: string) => void;
  onOpenJobDetail: (jobId: string) => void;
}

function RecentSalesmanPaidTable({ entries, onOpenJob, onOpenJobDetail }: RecentSalesmanPaidTableProps) {
  const theme = useTheme();

  return (
    <Table stickyHeader size="small" sx={{ minWidth: 860 }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 700, minWidth: 120, bgcolor: 'background.paper' }}>
            Paid date
          </TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: 110, bgcolor: 'background.paper' }} align="right">
            Customer paid
          </TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: 160, bgcolor: 'background.paper' }}>
            Job
          </TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: 120, bgcolor: 'background.paper' }}>
            Payment
          </TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: 100, bgcolor: 'background.paper' }} align="right">
            Commission
          </TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: 100, bgcolor: 'background.paper' }} align="right">
            Balance
          </TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: 90, bgcolor: 'background.paper' }}>
            Check #
          </TableCell>
          <TableCell sx={{ width: 44, bgcolor: 'background.paper' }} />
        </TableRow>
      </TableHead>
      <TableBody>
        {entries.map((entry, index) => (
          <TableRow
            key={`${entry.jobId}-${entry.paymentLabel}-${entry.date}-${index}`}
            hover
            onClick={() => onOpenJob(entry.jobId)}
            sx={{
              cursor: 'pointer',
              ...(entry.balance <= 0.01
                ? {
                    bgcolor: alpha(
                      theme.palette.success.main,
                      theme.palette.mode === 'dark' ? 0.08 : 0.04,
                    ),
                  }
                : undefined),
            }}
          >
            <TableCell sx={{ fontWeight: 600 }}>{formatCheckDisplayDate(entry.date)}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              {entry.customerPaidAmount != null && entry.customerPaidAmount > 0 ? (
                formatMoney(entry.customerPaidAmount)
              ) : (
                <Typography component="span" variant="body2" color="text.secondary">
                  —
                </Typography>
              )}
            </TableCell>
            <TableCell>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {entry.jobLabel || entry.customerName}
              </Typography>
              {entry.jobLabel && entry.customerName !== entry.jobLabel ? (
                <Typography variant="caption" color="text.secondary">
                  {entry.customerName}
                </Typography>
              ) : null}
            </TableCell>
            <TableCell>{entry.paymentLabel}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              {formatMoney(entry.amount)}
            </TableCell>
            <TableCell
              align="right"
              sx={{
                fontWeight: 600,
                color: entry.balance <= 0.01 ? 'success.main' : 'text.primary',
              }}
            >
              {formatMoney(entry.balance)}
            </TableCell>
            <TableCell>
              {entry.check ? (
                <Typography variant="body2">{entry.check}</Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  —
                </Typography>
              )}
            </TableCell>
            <TableCell sx={{ py: 0.5 }} onClick={(e) => e.stopPropagation()}>
              <Tooltip title="View job">
                <IconButton
                  size="small"
                  aria-label={`View job for ${entry.customerName}`}
                  onClick={() => onOpenJobDetail(entry.jobId)}
                >
                  <PersonIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface CommissionChecksTableProps {
  groups: CommissionCheckGroup[];
  onOpenJob: (jobId: string) => void;
  onOpenJobDetail: (jobId: string) => void;
  onSetGroupPaid: (group: CommissionCheckGroup) => void;
  onEditGroupCheck: (group: CommissionCheckGroup) => void;
}

function CommissionChecksTable({
  groups,
  onOpenJob,
  onOpenJobDetail,
  onSetGroupPaid,
  onEditGroupCheck,
}: CommissionChecksTableProps) {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [contextMenuGroup, setContextMenuGroup] = useState<CommissionCheckGroup | null>(null);

  const toggleGroup = (groupId: string) => {
    setExpanded((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleGroupContextMenu = (
    event: MouseEvent,
    group: CommissionCheckGroup,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6 });
    setContextMenuGroup(group);
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
    setContextMenuGroup(null);
  };

  const handleSetGroupPaid = () => {
    if (contextMenuGroup) onSetGroupPaid(contextMenuGroup);
    handleCloseContextMenu();
  };

  const handleEditGroupCheck = () => {
    if (contextMenuGroup) onEditGroupCheck(contextMenuGroup);
    handleCloseContextMenu();
  };

  return (
    <>
    <Table stickyHeader size="small" sx={{ minWidth: isMobile ? 0 : 760 }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ width: 44, bgcolor: 'background.paper' }} />
          <TableCell sx={{ fontWeight: 700, minWidth: isMobile ? 0 : 120, bgcolor: 'background.paper' }}>
            Paid date
          </TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: isMobile ? 0 : 120, bgcolor: 'background.paper' }}>
            Check / cash
          </TableCell>
          {/* The payment count is desktop-only — expanding the row already lists them. */}
          {!isMobile && (
            <TableCell sx={{ fontWeight: 700, minWidth: 100, bgcolor: 'background.paper' }}>
              Payments
            </TableCell>
          )}
          <TableCell sx={{ fontWeight: 700, minWidth: isMobile ? 0 : 120, bgcolor: 'background.paper' }} align="right">
            Total
          </TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {groups.map((group) => {
          const isOpen = Boolean(expanded[group.id]);
          return (
            <Fragment key={group.id}>
              <TableRow
                hover
                onClick={() => toggleGroup(group.id)}
                onContextMenu={(event) => handleGroupContextMenu(event, group)}
                sx={{
                  cursor: 'pointer',
                  bgcolor: alpha(
                    theme.palette.primary.main,
                    theme.palette.mode === 'dark' ? 0.08 : 0.04,
                  ),
                }}
              >
                <TableCell sx={{ py: 0.75 }}>
                  <IconButton
                    size="small"
                    aria-label={isOpen ? 'Collapse check details' : 'Expand check details'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleGroup(group.id);
                    }}
                  >
                    {isOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  </IconButton>
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{formatCheckDisplayDate(group.date)}</TableCell>
                <TableCell>
                  {group.isCash ? (
                    <Chip size="small" label="Cash" sx={{ height: 24, fontWeight: 600 }} />
                  ) : (
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {group.checkDisplay}
                    </Typography>
                  )}
                </TableCell>
                {!isMobile && (
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {group.entries.length} payment{group.entries.length === 1 ? '' : 's'}
                    </Typography>
                  </TableCell>
                )}
                <TableCell align="right">
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    {formatMoney(group.totalAmount)}
                  </Typography>
                </TableCell>
              </TableRow>
              <TableRow key={`${group.id}-details`}>
                <TableCell colSpan={isMobile ? 4 : 5} sx={{ py: 0, borderBottom: isOpen ? undefined : 0 }}>
                  <Collapse in={isOpen} timeout="auto" unmountOnExit>
                    <Box sx={{ py: 1, pl: isMobile ? 0 : 1, pr: isMobile ? 0 : 1 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            {/* Phones show four columns: the group row above already gives the
                                paid date, and the job name stands in for the customer. */}
                            {!isMobile && <TableCell sx={{ fontWeight: 600 }}>Paid date</TableCell>}
                            <TableCell sx={{ fontWeight: 600 }}>
                              {isMobile ? 'Customer paid' : 'Customer paid date'}
                            </TableCell>
                            {!isMobile && <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>}
                            <TableCell sx={{ fontWeight: 600 }}>Job</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Payment</TableCell>
                            <TableCell sx={{ fontWeight: 600 }} align="right">
                              Deposited
                            </TableCell>
                            <TableCell sx={{ fontWeight: 600 }} align="right">
                              Commission
                            </TableCell>
                            {!isMobile && <TableCell sx={{ width: 44 }} />}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {group.entries.map((entry, index) => (
                            <TableRow
                              key={`${entry.jobId}-${entry.paymentLabel}-${index}`}
                              hover
                              onClick={() => onOpenJob(entry.jobId)}
                              sx={{ cursor: 'pointer' }}
                            >
                              {!isMobile && (
                                <TableCell>{formatCheckDisplayDate(entry.date)}</TableCell>
                              )}
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                {formatCheckDisplayDate(entry.customerPaidDate)}
                              </TableCell>
                              {!isMobile && (
                                <TableCell sx={{ fontWeight: 600 }}>{entry.customerName}</TableCell>
                              )}
                              <TableCell sx={{ fontWeight: isMobile ? 600 : undefined }}>
                                {entry.jobLabel || (isMobile && entry.customerName) || 'Untitled'}
                              </TableCell>
                              <TableCell>{entry.paymentLabel}</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {entry.depositedAmount > 0 ? (
                                  formatMoney(entry.depositedAmount)
                                ) : (
                                  <Typography component="span" variant="body2" color="text.secondary">
                                    —
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {formatMoney(entry.amount)}
                              </TableCell>
                              {!isMobile && (
                                <TableCell sx={{ py: 0.5 }} onClick={(e) => e.stopPropagation()}>
                                  <Tooltip title="View job">
                                    <IconButton
                                      size="small"
                                      aria-label={`View job for ${entry.customerName}`}
                                      onClick={() => onOpenJobDetail(entry.jobId)}
                                    >
                                      <PersonIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </Collapse>
                </TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
    <Menu
      open={contextMenu !== null}
      onClose={handleCloseContextMenu}
      anchorReference="anchorPosition"
      anchorPosition={
        contextMenu !== null
          ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
          : undefined
      }
    >
      <MenuItem onClick={handleSetGroupPaid}>Set group to paid…</MenuItem>
      <MenuItem onClick={handleEditGroupCheck}>Edit check number…</MenuItem>
    </Menu>
    </>
  );
}

interface CheckGroupDialogProps {
  group: CommissionCheckGroup | null;
  open: boolean;
  mode: 'pay' | 'edit';
  onClose: () => void;
  onConfirm: (check: string, paidDate: string) => void;
}

function CheckGroupDialog({
  group,
  open,
  mode,
  onClose,
  onConfirm,
}: CheckGroupDialogProps) {
  const [checkNumber, setCheckNumber] = useState('');
  const [paidDate, setPaidDate] = useState('');
  const [isCash, setIsCash] = useState(false);

  useEffect(() => {
    if (!open || !group) return;
    setCheckNumber(group.isCash ? 'Cash' : group.checkKey === '__none__' ? '' : group.checkDisplay);
    setPaidDate(group.date || format(new Date(), 'yyyy-MM-dd'));
    setIsCash(group.isCash);
  }, [open, group]);

  if (!group) return null;

  const unpaidCount = group.entries.filter((entry) => !entry.salesmanPaid).length;
  const isPayMode = mode === 'pay';

  const handleConfirm = () => {
    const check = isCash ? 'Cash' : checkNumber.trim();
    if (!check) return;
    onConfirm(check, paidDate);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isPayMode ? 'Set group to paid' : 'Edit check number'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {group.entries.length} payment{group.entries.length === 1 ? '' : 's'} ·{' '}
          {formatMoney(group.totalAmount)}
          {isPayMode
            ? unpaidCount > 0
              ? ` · ${unpaidCount} not yet marked salesman paid`
              : ' · all already marked paid'
            : ''}
        </Typography>
        <FormControlLabel
          sx={{ mb: 1.5 }}
          control={
            <Checkbox
              checked={isCash}
              onChange={(e) => {
                const checked = e.target.checked;
                setIsCash(checked);
                if (checked) setCheckNumber('Cash');
                else if (checkNumber === 'Cash') setCheckNumber('');
              }}
            />
          }
          label="Cash payment"
        />
        <TextField
          fullWidth
          size="small"
          label="Check #"
          value={checkNumber}
          onChange={(e) => setCheckNumber(e.target.value)}
          disabled={isCash}
          placeholder="Enter check number"
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          size="small"
          type="date"
          label="Paid date"
          value={paidDate}
          onChange={(e) => setPaidDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          {isPayMode
            ? 'All payments in this group will use the same check number and be marked salesman paid.'
            : 'Updates the check number and paid date for every payment in this group. Salesman paid status is not changed.'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={!isCash && !checkNumber.trim()}
        >
          {isPayMode ? 'Apply to group' : 'Save changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function applyCheckGroupUpdates(
  current: CommissionLogLocalRow,
  jobEntries: CommissionCheckEntry[],
  options: { check: string; paidDate: string; markSalesmanPaid: boolean },
): CommissionLogLocalRow {
  const { check, paidDate, markSalesmanPaid } = options;

  for (const entry of jobEntries) {
    if (entry.entryKind === 'adjustment' && entry.adjustmentId) {
      const adjustments = [...(current.adjustments || [])];
      const index = adjustments.findIndex((row) => row.id === entry.adjustmentId);
      if (index < 0) continue;

      const existing = adjustments[index];
      adjustments[index] = {
        ...existing,
        check,
        date: paidDate || existing.date || entry.date,
        ...(markSalesmanPaid
          ? {
              salesmanPaid: true,
              amount:
                existing.amount !== undefined &&
                existing.amount !== null &&
                String(existing.amount).trim() !== ''
                  ? existing.amount
                  : entry.amount !== 0
                    ? String(entry.amount)
                    : existing.amount,
            }
          : {}),
      };
      current.adjustments = adjustments;
      continue;
    }

    if (entry.entryKind === 'payment' && entry.scheduleIndex !== undefined) {
      const payments = [...(current.payments || [])];
      while (payments.length <= entry.scheduleIndex) payments.push({});
      const existing = payments[entry.scheduleIndex] || {};
      const patch: CommissionPaymentLocal = {
        ...existing,
        check,
        date: paidDate || existing.date || entry.date,
        ...(markSalesmanPaid ? { salesmanPaid: true } : {}),
      };

      if (markSalesmanPaid) {
        const hasAmount =
          existing.amountManual ||
          (existing.amount !== undefined &&
            existing.amount !== null &&
            String(existing.amount).trim() !== '' &&
            Number(existing.amount) !== 0);

        if (!hasAmount && entry.amount !== 0) {
          patch.amount = formatMoneyInput(entry.amount);
          patch.amountManual = true;
        }
      }

      payments[entry.scheduleIndex] = patch;
      current.payments = payments;
    }
  }

  return current;
}

function hasExplicitManualAmount(saved: CommissionPaymentLocal): boolean {
  if (!saved.amountManual) return false;
  if (saved.amount === undefined || saved.amount === null) return false;
  if (typeof saved.amount === 'string') return saved.amount.trim() !== '';
  return true;
}

interface CommissionPaymentLocal {
  amount?: string | number;
  check?: string;
  date?: string;
  amountManual?: boolean;
  salesmanPaid?: boolean;
}

interface CommissionAdjustmentLocal {
  id: string;
  kind?: 'payment' | 'deduction';
  label?: string;
  note?: string;
  amount?: string | number;
  check?: string;
  date?: string;
  salesmanPaid?: boolean;
}

interface CommissionLogLocalRow {
  payments?: CommissionPaymentLocal[];
  adjustments?: CommissionAdjustmentLocal[];
  paymentOrder?: number[];
  payment1?: string | number;
  payment2?: string | number;
  payment1Check?: string;
  payment2Check?: string;
  payment1Date?: string;
  payment2Date?: string;
  commissionRate?: string | number;
  updatedAt?: string;
}

function newAdjustmentRow(): CommissionAdjustmentLocal {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'payment',
    label: 'Adjustment',
    note: '',
    amount: '',
    check: '',
    date: '',
    salesmanPaid: false,
  };
}

function newDeductionRow(amount = '', note = ''): CommissionAdjustmentLocal {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'deduction',
    label: 'Deduction',
    note,
    amount: amount === '' ? '' : String(amount),
    check: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    salesmanPaid: false,
  };
}

function migrateLocalRow(local: CommissionLogLocalRow): CommissionLogLocalRow {
  if (Array.isArray(local.payments)) return local;
  const payments: CommissionPaymentLocal[] = [];
  const legacy = [
    { amount: local.payment1, check: local.payment1Check, date: local.payment1Date },
    { amount: local.payment2, check: local.payment2Check, date: local.payment2Date },
  ];
  for (const entry of legacy) {
    if (entry.amount !== undefined || entry.check || entry.date) {
      payments.push({
        ...entry,
        amountManual: entry.amount !== undefined,
      });
    }
  }
  if (!payments.length) return local;
  return { ...local, payments };
}

function hasRateOverride(local: CommissionLogLocalRow): boolean {
  return local.commissionRate !== undefined && local.commissionRate !== '';
}

function readCommissionLogRows(): Record<string, CommissionLogLocalRow> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(COMMISSION_LOGS_STORAGE_KEY);
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, CommissionLogLocalRow>)
      : {};
  } catch {
    return {};
  }
}

function hasCommissionLogData(row: CommissionLogLocalRow): boolean {
  const migrated = migrateLocalRow(row);
  if (hasRateOverride(migrated)) return true;
  if (Array.isArray(migrated.paymentOrder) && migrated.paymentOrder.length > 0) return true;
  const adjustments = migrated.adjustments || [];
  if (
    adjustments.some(
      (adjustment) =>
        adjustment.salesmanPaid ||
        Boolean(adjustment.check) ||
        Boolean(adjustment.date) ||
        Boolean(String(adjustment.label || '').trim()) ||
        Boolean(String(adjustment.note || '').trim()) ||
        (adjustment.amount !== undefined &&
          adjustment.amount !== null &&
          String(adjustment.amount).trim() !== ''),
    )
  ) {
    return true;
  }
  const payments = migrated.payments || [];
  return payments.some(
    (payment) =>
      payment.salesmanPaid ||
      Boolean(payment.check) ||
      Boolean(payment.date) ||
      payment.amountManual ||
      (payment.amount !== undefined &&
        payment.amount !== null &&
        String(payment.amount).trim() !== ''),
  );
}

function mergeCommissionLogRow(
  dbRow?: CommissionLogLocalRow | null,
  localRow?: CommissionLogLocalRow | null,
): CommissionLogLocalRow | null {
  const db = dbRow ? migrateLocalRow(dbRow) : null;
  const local = localRow ? migrateLocalRow(localRow) : null;
  if (!db && !local) return null;
  if (!db) return local;
  if (!local) return db;
  const dbTime = Date.parse(String(db.updatedAt || '')) || 0;
  const localTime = Date.parse(String(local.updatedAt || '')) || 0;
  return dbTime >= localTime ? db : local;
}

async function persistCommissionLog(jobId: string, data: CommissionLogLocalRow): Promise<void> {
  await axios.patch(`${API_URL}/jobs/${jobId}`, {
    commissionLog: {
      ...migrateLocalRow(data),
      updatedAt: data.updatedAt || new Date().toISOString(),
    },
  });
}

interface PaymentScheduleDoc {
  type?: string;
  items?: Array<{
    label?: string;
    amountType?: string;
    percentage?: number;
    amount?: number;
    dueType?: string;
    sortOrder?: number;
    status?: string;
    paidAt?: string | null;
    paidAmount?: number;
  }>;
}

interface JobDoc {
  _id?: string;
  title?: string;
  color?: string;
  isArchived?: boolean;
  customerId?: string | {
    name?: string;
    primaryPhone?: string;
    primaryEmail?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
  };
  assignedTo?: string | { name?: string };
  stage?: string;
  isDeadEstimate?: boolean;
  valueContracted?: number;
  valueEstimated?: number;
  changeOrders?: Array<{ description?: string; amount?: number }>;
  paymentSchedule?: PaymentScheduleDoc;
  contract?: {
    depositReceived?: number;
    depositReceivedAt?: string;
  };
  finalPayment?: {
    amountPaid?: number;
    paidAt?: string;
  };
  commissionLog?: CommissionLogLocalRow;
  jobAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  jobContact?: {
    phone?: string;
    email?: string;
  };
  notes?: Array<{ content?: string }>;
}

interface EstimateDoc {
  jobId?: string | { _id?: string };
  grandTotal?: number;
  createdAt?: string;
}

interface JobsListResponse {
  jobs?: JobDoc[];
  totalPages?: number;
}

interface CompletedJobsGroup {
  jobs?: JobDoc[];
}

async function fetchAllCommissionJobs(): Promise<JobDoc[]> {
  const jobsById = new Map<string, JobDoc>();
  const limit = 500;
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const { data } = await axios.get<JobsListResponse>(`${API_URL}/jobs`, {
      params: {
        page,
        limit,
        includeCompletedClosedOut: true,
        includeArchived: false,
      },
    });
    const batch = Array.isArray(data?.jobs) ? data.jobs : [];
    for (const job of batch) {
      jobsById.set(String(job._id || ''), job);
    }
    totalPages = Math.max(1, Number(data?.totalPages) || 1);
    page += 1;
  }

  try {
    const { data: completedGroups } = await axios.get<CompletedJobsGroup[]>(
      `${API_URL}/jobs/completed`,
    );
    if (Array.isArray(completedGroups)) {
      for (const group of completedGroups) {
        const groupJobs = Array.isArray(group?.jobs) ? group.jobs : [];
        for (const job of groupJobs) {
          const id = String(job._id || '');
          if (id && !job.isArchived && !jobsById.has(id)) jobsById.set(id, job);
        }
      }
    }
  } catch (error) {
    console.warn('Could not merge completed jobs into commission logs:', error);
  }

  return Array.from(jobsById.values());
}

interface CommissionSourceJobRow {
  jobId: string;
  customerName: string;
  jobLabel: string;
  assignedToName: string;
  stageLabel: string;
  jobTotal: number;
  jobColor?: string;
  searchText: string;
  paymentSchedule?: PaymentScheduleDoc;
  contract?: JobDoc['contract'];
  finalPayment?: JobDoc['finalPayment'];
}

interface CommissionPaymentDisplay {
  scheduleIndex: number;
  label: string;
  scheduledAmount: number;
  depositedAmount: number;
  potentialAmount: number;
  amount: number;
  displayAmount: string | number;
  check: string;
  date: string;
  customerPaidDate: string;
  status: string;
  amountManual: boolean;
  customerPaid: boolean;
  salesmanPaid: boolean;
}

interface CommissionAdjustmentDisplay {
  id: string;
  kind: 'payment' | 'deduction';
  label: string;
  note: string;
  amount: number;
  displayAmount: string | number;
  check: string;
  date: string;
  salesmanPaid: boolean;
}

interface CommissionTableRow extends CommissionSourceJobRow {
  commissionRate: number;
  rateOverridden: boolean;
  commissionDue: number;
  payments: CommissionPaymentDisplay[];
  adjustments: CommissionAdjustmentDisplay[];
  paymentOrder?: number[];
  hasManualPayments: boolean;
  depositedTotal: number;
  paidToSalesman: number;
  deductionTotal: number;
  balance: number;
  isRowSettled: boolean;
}

function cloneCommissionLogRow(row: CommissionLogLocalRow): CommissionLogLocalRow {
  return JSON.parse(JSON.stringify(migrateLocalRow(row)));
}

function buildCommissionTableRow(
  source: CommissionSourceJobRow,
  localRaw: CommissionLogLocalRow,
  defaultCommissionRate: number,
): CommissionTableRow {
  const local = migrateLocalRow(localRaw);
  const rateOverridden = hasRateOverride(local);
  const rateRaw = rateOverridden ? local.commissionRate : defaultCommissionRate;
  const commissionRate = Number(rateRaw);
  const safeRate = Number.isFinite(commissionRate) && commissionRate >= 0 ? commissionRate : 0;
  const jobTotal = roundMoney(source.jobTotal);
  const commissionDue = roundMoney(jobTotal * (safeRate / 100));

  const splits = getCommissionPaymentSplits(
    {
      paymentSchedule: source.paymentSchedule,
      contract: source.contract,
      finalPayment: source.finalPayment,
      valueContracted: jobTotal,
      valueEstimated: jobTotal,
    },
    jobTotal,
    commissionDue,
  );

  const savedPayments = local.payments || [];
  const builtPayments: CommissionPaymentDisplay[] = splits.map((split, idx) => {
    const saved = savedPayments[idx] || {};
    const status = split.status || 'pending';
    const potentialAmount = split.amount;
    const autoDate = status === 'paid' ? toDateInputValue(split.paidAt) : '';

    let amount = 0;
    let displayAmount: string | number = '';
    const amountManual = Boolean(saved.amountManual);

    if (amountManual) {
      displayAmount = saved.amount ?? '';
      const rawAmount = saved.amount;
      amount =
        rawAmount === '' || rawAmount === undefined || rawAmount === null
          ? 0
          : roundMoney(Number(rawAmount) || 0);
    } else if (status === 'paid') {
      amount = potentialAmount;
      displayAmount = potentialAmount > 0 ? formatMoneyInput(potentialAmount) : '';
    }

    const customerPaid = status === 'paid';
    const salesmanPaid = safeRate <= 0 ? true : Boolean(saved.salesmanPaid);

    return {
      scheduleIndex: idx,
      label: split.label,
      scheduledAmount: split.scheduledAmount,
      depositedAmount: roundMoney(Number(split.depositedAmount) || 0),
      potentialAmount,
      amount,
      displayAmount,
      check: String(saved.check || ''),
      date: String(saved.date || autoDate),
      customerPaidDate: customerPaid ? autoDate : '',
      status,
      amountManual,
      customerPaid,
      salesmanPaid,
    };
  });

  const payments = orderPaymentsForDisplay(builtPayments, local.paymentOrder, {
    preserveOrder: true,
  });

  const builtAdjustments: CommissionAdjustmentDisplay[] = (local.adjustments || []).map((saved) => {
    const rawAmount = saved.amount;
    const amount =
      rawAmount === '' || rawAmount === undefined || rawAmount === null
        ? 0
        : roundMoney(Number(rawAmount) || 0);
    const kind = saved.kind === 'deduction' ? 'deduction' : 'payment';

    return {
      id: saved.id,
      kind,
      label:
        String(saved.label || (kind === 'deduction' ? 'Deduction' : 'Adjustment')).trim() ||
        (kind === 'deduction' ? 'Deduction' : 'Adjustment'),
      note: String(saved.note || ''),
      amount: kind === 'deduction' ? Math.abs(amount) : amount,
      displayAmount: saved.amount ?? '',
      check: String(saved.check || ''),
      date: String(saved.date || ''),
      salesmanPaid: kind === 'deduction' ? false : safeRate <= 0 ? true : Boolean(saved.salesmanPaid),
    };
  });

  const depositedTotal = roundMoney(
    payments.reduce((sum, payment) => sum + (Number(payment.depositedAmount) || 0), 0),
  );
  const schedulePaidTotal = roundMoney(
    payments.reduce((sum, payment) => sum + (payment.salesmanPaid ? payment.amount : 0), 0),
  );
  const adjustmentPaidTotal = roundMoney(
    builtAdjustments.reduce(
      (sum, adjustment) =>
        sum + (adjustment.kind === 'payment' && adjustment.salesmanPaid ? adjustment.amount : 0),
      0,
    ),
  );
  const paidToSalesman = roundMoney(schedulePaidTotal + adjustmentPaidTotal);
  const deductionTotal = roundMoney(
    builtAdjustments.reduce(
      (sum, adjustment) => sum + (adjustment.kind === 'deduction' ? adjustment.amount : 0),
      0,
    ),
  );
  const balance = roundMoney(commissionDue - paidToSalesman - deductionTotal);
  const hasManualPayments = payments.some((payment) => payment.amountManual);
  const isRowSettled = safeRate <= 0 || (jobTotal > 0 && balance >= -0.01 && balance <= 0.01);

  return {
    ...source,
    commissionRate: safeRate,
    rateOverridden,
    commissionDue,
    payments,
    adjustments: builtAdjustments,
    paymentOrder:
      Array.isArray(local.paymentOrder) && local.paymentOrder.length > 0 ? local.paymentOrder : undefined,
    hasManualPayments,
    depositedTotal,
    paidToSalesman,
    deductionTotal,
    balance,
    isRowSettled,
  };
}

function patchCommissionPaymentLocal(
  current: CommissionLogLocalRow,
  scheduleIndex: number,
  patch: Partial<CommissionPaymentLocal>,
  options?: { manual?: boolean },
): CommissionLogLocalRow {
  const payments = [...(current.payments || [])];
  while (payments.length <= scheduleIndex) payments.push({});
  const nextPatch = { ...patch };
  if (options?.manual === true) {
    nextPatch.amountManual = true;
  }
  if (options?.manual === false) {
    nextPatch.amountManual = false;
  }
  payments[scheduleIndex] = { ...payments[scheduleIndex], ...nextPatch };
  return {
    ...current,
    payments,
    updatedAt: new Date().toISOString(),
  };
}

function isCommissionOverpaid(row: CommissionTableRow): boolean {
  return row.balance < -0.01;
}

function isZeroCommissionJob(row: CommissionTableRow): boolean {
  return row.rateOverridden && row.commissionRate <= 0;
}

function allSalesmanPaid(row: CommissionTableRow): boolean {
  return row.payments.length > 0 && row.payments.every((payment) => payment.salesmanPaid);
}

type CommissionRowBucket = 'active' | 'underpaid' | 'overpaid' | 'settled';

function getCommissionRowBucket(row: CommissionTableRow): CommissionRowBucket {
  if (isCommissionOverpaid(row)) return 'overpaid';
  if (allSalesmanPaid(row) && row.balance > 0.01) return 'underpaid';
  if (row.balance >= -0.01 && row.balance <= 0.01 && (allSalesmanPaid(row) || row.isRowSettled)) {
    return 'settled';
  }
  return 'active';
}

function isOverviewActiveRow(row: CommissionTableRow): boolean {
  return getCommissionRowBucket(row) === 'active';
}

function compareCustomerName(a: CommissionTableRow, b: CommissionTableRow): number {
  return String(a.customerName || '').localeCompare(String(b.customerName || ''));
}

function joinAddressParts(
  addr?: { street?: string; city?: string; state?: string; zip?: string } | null,
): string {
  if (!addr) return '';
  return [addr.street, addr.city, addr.state, addr.zip]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

function moneySearchTokens(value: unknown): string[] {
  const n = roundMoney(Number(value));
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return [];
  return [String(n), n.toFixed(2), formatMoney(n)];
}

function buildCommissionJobSearchText(job: JobDoc, jobTotal: number): string {
  const parts: string[] = [];
  const customer = typeof job?.customerId === 'object' ? job.customerId : null;

  parts.push(
    String(job?.title || ''),
    String(customer?.name || ''),
    joinAddressParts(job?.jobAddress),
    joinAddressParts(customer?.address),
    String(job?.jobContact?.phone || ''),
    String(job?.jobContact?.email || ''),
    String(customer?.primaryPhone || ''),
    String(customer?.primaryEmail || ''),
  );

  for (const token of moneySearchTokens(jobTotal)) parts.push(token);
  for (const token of moneySearchTokens(job?.valueContracted)) parts.push(token);
  for (const token of moneySearchTokens(job?.valueEstimated)) parts.push(token);
  for (const token of moneySearchTokens(job?.contract?.depositReceived)) parts.push(token);
  for (const token of moneySearchTokens(job?.finalPayment?.amountPaid)) parts.push(token);

  for (const item of job?.paymentSchedule?.items || []) {
    parts.push(String(item?.label || ''));
    for (const token of moneySearchTokens(item?.amount)) parts.push(token);
    for (const token of moneySearchTokens(item?.paidAmount)) parts.push(token);
  }

  for (const co of job?.changeOrders || []) {
    parts.push(String(co?.description || ''));
    for (const token of moneySearchTokens(co?.amount)) parts.push(token);
  }

  for (const note of job?.notes || []) {
    parts.push(String(note?.content || ''));
  }

  return parts
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesCommissionSearch(row: CommissionTableRow, rawQuery: string): boolean {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return true;

  const qNormalized = q.replace(/[,$]/g, '');
  const haystackParts: unknown[] = [
    row.searchText,
    row.customerName,
    row.jobLabel,
    row.assignedToName,
    row.stageLabel,
    ...moneySearchTokens(row.jobTotal),
    ...moneySearchTokens(row.depositedTotal),
    ...moneySearchTokens(row.commissionDue),
    ...moneySearchTokens(row.balance),
    String(row.commissionRate),
    ...row.payments.flatMap((payment) => [
      payment.label,
      payment.check,
      payment.date,
      payment.status,
      payment.displayAmount,
      ...moneySearchTokens(payment.scheduledAmount),
      ...moneySearchTokens(payment.depositedAmount),
      ...moneySearchTokens(payment.potentialAmount),
      ...moneySearchTokens(payment.amount),
    ]),
    ...row.adjustments.flatMap((adjustment) => [
      adjustment.label,
      adjustment.note,
      adjustment.kind,
      adjustment.check,
      adjustment.date,
      adjustment.displayAmount,
      ...moneySearchTokens(adjustment.amount),
    ]),
  ];

  const haystack = haystackParts
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
  const haystackNormalized = haystack.replace(/[,$]/g, '');

  if (haystack.includes(q)) return true;
  return qNormalized.length > 0 && haystackNormalized.includes(qNormalized);
}

function applyOverviewJobOrder(
  rows: CommissionTableRow[],
  order: string[] | undefined,
): CommissionTableRow[] {
  const buckets: Record<CommissionRowBucket, CommissionTableRow[]> = {
    active: [],
    underpaid: [],
    overpaid: [],
    settled: [],
  };

  for (const row of rows) {
    buckets[getCommissionRowBucket(row)].push(row);
  }

  let orderedActive: CommissionTableRow[];
  if (!order?.length) {
    orderedActive = [...buckets.active].sort(compareCustomerName);
  } else {
    const activeById = new Map(buckets.active.map((row) => [row.jobId, row]));
    const ordered: CommissionTableRow[] = [];
    const seen = new Set<string>();

    for (const id of order) {
      const row = activeById.get(id);
      if (row) {
        ordered.push(row);
        seen.add(id);
      }
    }

    const remaining = buckets.active.filter((row) => !seen.has(row.jobId)).sort(compareCustomerName);
    orderedActive = [...ordered, ...remaining];
  }

  const sortAlpha = (list: CommissionTableRow[]) => [...list].sort(compareCustomerName);

  return [
    ...orderedActive,
    ...sortAlpha(buckets.underpaid),
    ...sortAlpha(buckets.overpaid),
    ...sortAlpha(buckets.settled),
  ];
}

function tierChipStyles(
  theme: Theme,
  payment: CommissionPaymentDisplay,
) {
  if (payment.salesmanPaid) {
    return {
      borderColor: 'success.main',
      bgcolor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.32 : 0.18),
      color: theme.palette.success.main,
    };
  }
  if (payment.customerPaid) {
    return {
      borderColor: 'grey.500',
      bgcolor: alpha(theme.palette.grey[500], theme.palette.mode === 'dark' ? 0.24 : 0.14),
      color: theme.palette.text.secondary,
    };
  }
  if (payment.status === 'invoiced') {
    return {
      borderColor: 'warning.main',
      bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.22 : 0.14),
      color: theme.palette.warning.main,
    };
  }
  return {
    borderColor: 'divider',
    bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    color: 'text.secondary',
  };
}

interface CommissionOverviewTiersProps {
  payments: CommissionPaymentDisplay[];
}

function CommissionOverviewTiers({ payments }: CommissionOverviewTiersProps) {
  const theme = useTheme();
  const isMobile = useIsMobile();
  // Preserve commissionLog paymentOrder — do not re-sort by scheduleIndex here.

  return (
    <Box
      sx={{
        display: 'flex',
        // Phones keep every tier on one line; wide labels truncate instead of stacking.
        flexWrap: isMobile ? 'nowrap' : 'wrap',
        gap: isMobile ? 0.375 : 0.75,
        minWidth: 0,
        overflow: isMobile ? 'hidden' : undefined,
      }}
    >
      {payments.map((payment) => {
        const styles = tierChipStyles(theme, payment);
        const dueAmount = payment.amount > 0 ? payment.amount : payment.potentialAmount;
        const statusLabel = payment.salesmanPaid
          ? 'Salesman paid'
          : payment.customerPaid
            ? 'Customer paid — commission owed'
            : PAYMENT_STATUS_LABELS[payment.status] || payment.status;
        return (
          <Tooltip
            key={payment.scheduleIndex}
            title={`${payment.label}: ${statusLabel}${
              payment.depositedAmount > 0 ? ` · deposited ${formatMoney(payment.depositedAmount)}` : ''
            } · ${formatMoney(dueAmount)} commission`}
          >
            <Box
              sx={{
                px: isMobile ? 0.5 : 1.25,
                py: isMobile ? 0.25 : 0.75,
                borderRadius: 1,
                border: 1,
                minWidth: isMobile ? 0 : 88,
                overflow: 'hidden',
                ...styles,
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  display: 'block',
                  lineHeight: 1.2,
                  fontSize: isMobile ? '0.5625rem' : undefined,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {payment.label}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  opacity: 0.9,
                  fontSize: isMobile ? '0.5625rem' : undefined,
                  whiteSpace: 'nowrap',
                }}
              >
                {formatMoney(dueAmount)}
              </Typography>
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

interface SortableOverviewRowProps {
  row: CommissionTableRow;
  onOpenPayments: (row: CommissionTableRow) => void;
  onOpenJobDetail: (jobId: string) => void;
}

function SortableOverviewRow({ row, onOpenPayments, onOpenJobDetail }: SortableOverviewRowProps) {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.jobId, disabled: !isOverviewActiveRow(row) });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      hover
      onClick={() => onOpenPayments(row)}
      sx={{
        cursor: 'pointer',
        ...(getCommissionRowBucket(row) === 'overpaid'
          ? {
              bgcolor: alpha(
                theme.palette.error.main,
                theme.palette.mode === 'dark' ? 0.12 : 0.08,
              ),
            }
          : getCommissionRowBucket(row) === 'settled'
            ? {
                bgcolor: alpha(
                  theme.palette.success.main,
                  theme.palette.mode === 'dark' ? 0.1 : 0.06,
                ),
              }
            : undefined),
      }}
    >
      {/* Reorder handle, job column, rate and the view-job shortcut are desktop-only. */}
      {!isMobile && (
      <TableCell sx={{ width: 40, px: 0.5, verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
        {isOverviewActiveRow(row) ? (
          <IconButton
            size="small"
            {...attributes}
            {...listeners}
            sx={{
              cursor: 'grab',
              touchAction: 'none',
              color: 'text.secondary',
              '&:active': { cursor: 'grabbing' },
            }}
            aria-label={`Drag to reorder ${row.customerName}`}
          >
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
        ) : null}
      </TableCell>
      )}
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {row.customerName}
        </Typography>
        {isMobile && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {row.jobLabel || 'Untitled'}
          </Typography>
        )}
      </TableCell>
      {!isMobile && (
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {row.jobLabel || 'Untitled'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {row.stageLabel || '-'}
        </Typography>
      </TableCell>
      )}
      <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {formatMoney(row.jobTotal)}
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {row.depositedTotal > 0 ? formatMoney(row.depositedTotal) : '—'}
      </TableCell>
      {!isMobile && (
      <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {formatCommissionRateLabel(row.commissionRate)}
      </TableCell>
      )}
      <TableCell sx={{ py: 1, ...(isMobile ? { maxWidth: 0, width: '45%' } : null) }}>
        <CommissionOverviewTiers payments={row.payments} />
      </TableCell>
      {!isMobile && (
      <TableCell sx={{ width: 44, px: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="View job">
          <IconButton
            size="small"
            aria-label={`View job for ${row.customerName}`}
            onClick={() => onOpenJobDetail(row.jobId)}
          >
            <PersonIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </TableCell>
      )}
    </TableRow>
  );
}

interface CommissionOverviewTableProps {
  rows: CommissionTableRow[];
  onReorder: (order: string[]) => void;
  onOpenPayments: (row: CommissionTableRow) => void;
  onOpenJobDetail: (jobId: string) => void;
}

function CommissionOverviewTable({ rows, onReorder, onOpenPayments, onOpenJobDetail }: CommissionOverviewTableProps) {
  const isMobile = useIsMobile();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const rowIds = rows.map((row) => row.jobId);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const unpaidRows = rows.filter((row) => isOverviewActiveRow(row));
    const unpaidIds = unpaidRows.map((row) => row.jobId);
    const oldIndex = unpaidIds.indexOf(String(active.id));
    const newIndex = unpaidIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    onReorder(arrayMove(unpaidIds, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <Table stickyHeader size="small" sx={{ minWidth: isMobile ? 0 : 680 }}>
        <TableHead>
          <TableRow>
            {!isMobile && <TableCell sx={{ width: 40, bgcolor: 'background.paper' }} />}
            <TableCell sx={{ fontWeight: 700, minWidth: isMobile ? 0 : 140, bgcolor: 'background.paper' }}>
              Customer
            </TableCell>
            {!isMobile && (
            <TableCell sx={{ fontWeight: 700, minWidth: 140, bgcolor: 'background.paper' }}>
              Job
            </TableCell>
            )}
            <TableCell
              sx={{ fontWeight: 700, minWidth: isMobile ? 0 : 100, bgcolor: 'background.paper' }}
              align="right"
            >
              {isMobile ? 'Total' : 'Job Total'}
            </TableCell>
            <TableCell
              sx={{ fontWeight: 700, minWidth: isMobile ? 0 : 100, bgcolor: 'background.paper' }}
              align="right"
            >
              Deposited
            </TableCell>
            {!isMobile && (
            <TableCell
              sx={{ fontWeight: 700, minWidth: 72, bgcolor: 'background.paper' }}
              align="right"
            >
              Rate
            </TableCell>
            )}
            <TableCell sx={{ fontWeight: 700, minWidth: isMobile ? 0 : 280, bgcolor: 'background.paper' }}>
              Payment tiers
            </TableCell>
            {!isMobile && <TableCell sx={{ width: 44, bgcolor: 'background.paper' }} />}
          </TableRow>
        </TableHead>
        <TableBody>
          <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
            {rows.map((row) => (
              <SortableOverviewRow
                key={row.jobId}
                row={row}
                onOpenPayments={onOpenPayments}
                onOpenJobDetail={onOpenJobDetail}
              />
            ))}
          </SortableContext>
        </TableBody>
      </Table>
    </DndContext>
  );
}

function orderPaymentsForDisplay(
  payments: CommissionPaymentDisplay[],
  paymentOrder: number[] | undefined,
  options?: { preserveOrder?: boolean },
): CommissionPaymentDisplay[] {
  if (options?.preserveOrder) {
    if (Array.isArray(paymentOrder) && paymentOrder.length > 0) {
      const orderMap = new Map(paymentOrder.map((idx, order) => [idx, order]));
      return [...payments].sort((a, b) => {
        const aOrder = orderMap.get(a.scheduleIndex);
        const bOrder = orderMap.get(b.scheduleIndex);
        if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
        if (aOrder !== undefined) return -1;
        if (bOrder !== undefined) return 1;
        return a.scheduleIndex - b.scheduleIndex;
      });
    }
    return [...payments].sort((a, b) => a.scheduleIndex - b.scheduleIndex);
  }

  const active = payments.filter((payment) => !payment.salesmanPaid);
  const settled = payments.filter((payment) => payment.salesmanPaid);

  const settledSorted = [...settled].sort((a, b) =>
    String(a.label || '').localeCompare(String(b.label || '')),
  );

  let activeSorted: CommissionPaymentDisplay[];
  if (Array.isArray(paymentOrder) && paymentOrder.length > 0) {
    const orderMap = new Map(paymentOrder.map((idx, order) => [idx, order]));
    activeSorted = [...active].sort((a, b) => {
      const aOrder = orderMap.get(a.scheduleIndex);
      const bOrder = orderMap.get(b.scheduleIndex);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return a.scheduleIndex - b.scheduleIndex;
    });
  } else {
    activeSorted = [...active].sort((a, b) => a.scheduleIndex - b.scheduleIndex);
  }

  return [...activeSorted, ...settledSorted];
}

function paymentCardStyles(
  theme: Theme,
  payment: CommissionPaymentDisplay,
) {
  if (payment.salesmanPaid) {
    return {
      borderColor: 'success.main',
      bgcolor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.32 : 0.2),
    };
  }
  if (payment.customerPaid) {
    return {
      borderColor: 'grey.500',
      bgcolor: alpha(theme.palette.grey[500], theme.palette.mode === 'dark' ? 0.2 : 0.1),
    };
  }
  if (payment.status === 'invoiced') {
    return {
      borderColor: 'warning.main',
      bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.18 : 0.12),
    };
  }
  return {
    borderColor: 'divider',
    bgcolor: 'background.paper',
  };
}

function paymentStatusChipProps(payment: CommissionPaymentDisplay): {
  label: string;
  color: 'success' | 'warning' | 'default';
  variant: 'filled' | 'outlined';
} {
  if (payment.salesmanPaid) {
    return { label: 'Salesman paid', color: 'success', variant: 'filled' };
  }
  if (payment.customerPaid) {
    return { label: 'Customer paid', color: 'default', variant: 'filled' };
  }
  if (payment.status === 'invoiced') {
    return { label: PAYMENT_STATUS_LABELS.invoiced, color: 'warning', variant: 'outlined' };
  }
  return {
    label: PAYMENT_STATUS_LABELS[payment.status] || payment.status,
    color: 'default',
    variant: 'outlined',
  };
}

interface SortablePaymentCardProps {
  payment: CommissionPaymentDisplay;
  jobId: string;
  draggable: boolean;
  layout?: 'vertical' | 'horizontal';
  onUpdateAmount: (scheduleIndex: number, value: string) => void;
  onUpdateDate: (scheduleIndex: number, value: string) => void;
  onUpdateCheck: (scheduleIndex: number, value: string) => void;
  onUpdateSalesmanPaid: (scheduleIndex: number, paid: boolean) => void;
}

const paymentFieldSx = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button':
    { WebkitAppearance: 'none', margin: 0 },
};

function SortablePaymentCard({
  payment,
  jobId,
  draggable,
  layout = 'horizontal',
  onUpdateAmount,
  onUpdateDate,
  onUpdateCheck,
  onUpdateSalesmanPaid,
}: SortablePaymentCardProps) {
  const theme = useTheme();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${jobId}-${payment.scheduleIndex}`,
    disabled: !draggable,
  });

  const cardStyle = paymentCardStyles(theme, payment);
  const statusChip = paymentStatusChipProps(payment);
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  const isVertical = layout === 'vertical';

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        ...(isVertical
          ? { width: '100%', p: 1.5, borderRadius: 1.5 }
          : { minWidth: 196, flex: '0 0 auto', p: 1, borderRadius: 1 }),
        border: 1,
        ...cardStyle,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 0.5,
          mb: isVertical ? 1 : 0.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          {draggable && (
            <Box
              {...attributes}
              {...listeners}
              sx={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'grab',
                color: 'text.secondary',
                touchAction: 'none',
                '&:active': { cursor: 'grabbing' },
              }}
              aria-label="Drag to reorder payment"
            >
              <DragIndicatorIcon sx={{ fontSize: isVertical ? 20 : 16 }} />
            </Box>
          )}
          <Typography
            variant={isVertical ? 'subtitle2' : 'caption'}
            sx={{ fontWeight: 700 }}
            noWrap={!isVertical}
          >
            {payment.label}
          </Typography>
        </Box>
        <Chip
          size="small"
          variant={statusChip.variant}
          label={statusChip.label}
          color={statusChip.color}
          sx={{ height: 22, fontSize: '0.7rem', flexShrink: 0 }}
        />
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: isVertical ? 1.25 : 0.75 }}
      >
        {payment.depositedAmount > 0
          ? `Deposited: ${formatMoney(payment.depositedAmount)}`
          : `Job payment: ${formatMoney(payment.scheduledAmount)}`}
        {!payment.salesmanPaid && payment.potentialAmount > 0
          ? ` · Commission due: ${formatMoney(payment.potentialAmount)}`
          : ''}
      </Typography>
      <Box
        sx={
          isVertical
            ? {
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  md: 'minmax(140px, 1fr) minmax(148px, 1fr) minmax(120px, 1fr) auto',
                },
                gap: 1.5,
                alignItems: 'center',
              }
            : undefined
        }
      >
        <TextField
          size="small"
          fullWidth
          label={isVertical ? 'Commission amount' : undefined}
          value={payment.displayAmount}
          onChange={(e) => onUpdateAmount(payment.scheduleIndex, e.target.value)}
          placeholder={
            payment.status === 'paid'
              ? 'Amount'
              : payment.potentialAmount > 0
                ? `Auto: ${formatMoney(payment.potentialAmount)}`
                : 'Amount'
          }
          sx={{ ...(isVertical ? paymentFieldSx : {}), mb: isVertical ? 0 : 0.75 }}
          InputProps={{
            startAdornment: <InputAdornment position="start">$</InputAdornment>,
            inputProps: { inputMode: 'decimal' },
          }}
        />
        <TextField
          size="small"
          fullWidth
          type="date"
          label={isVertical ? 'Paid date' : undefined}
          value={payment.date}
          onChange={(e) => onUpdateDate(payment.scheduleIndex, e.target.value)}
          sx={{ mb: isVertical ? 0 : 0.75 }}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          size="small"
          fullWidth
          label={isVertical ? 'Check #' : undefined}
          value={payment.check}
          onChange={(e) => onUpdateCheck(payment.scheduleIndex, e.target.value)}
          placeholder="Check #"
          sx={isVertical ? paymentFieldSx : undefined}
        />
        <FormControlLabel
          sx={{
            mt: isVertical ? 0 : 0.75,
            ml: 0,
            mr: 0,
            justifySelf: isVertical ? { md: 'start' } : undefined,
          }}
          control={
            <Checkbox
              size="small"
              checked={payment.salesmanPaid}
              onChange={(e) => onUpdateSalesmanPaid(payment.scheduleIndex, e.target.checked)}
            />
          }
          label={
            <Typography variant={isVertical ? 'body2' : 'caption'} sx={{ fontWeight: 600 }}>
              Salesman paid
            </Typography>
          }
        />
      </Box>
    </Box>
  );
}

interface AdjustmentPaymentCardProps {
  adjustment: CommissionAdjustmentDisplay;
  onUpdateLabel: (id: string, value: string) => void;
  onUpdateNote: (id: string, value: string) => void;
  onUpdateAmount: (id: string, value: string) => void;
  onUpdateDate: (id: string, value: string) => void;
  onUpdateCheck: (id: string, value: string) => void;
  onUpdateSalesmanPaid: (id: string, paid: boolean) => void;
  onRemove: (id: string) => void;
}

function AdjustmentPaymentCard({
  adjustment,
  onUpdateLabel,
  onUpdateNote,
  onUpdateAmount,
  onUpdateDate,
  onUpdateCheck,
  onUpdateSalesmanPaid,
  onRemove,
}: AdjustmentPaymentCardProps) {
  const theme = useTheme();
  const isDeduction = adjustment.kind === 'deduction';
  const cardStyle = isDeduction
    ? {
        borderColor: 'warning.main',
        bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
      }
    : adjustment.salesmanPaid
      ? {
          borderColor: 'success.main',
          bgcolor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.32 : 0.2),
        }
      : {
          borderColor: 'info.main',
          bgcolor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.16 : 0.08),
        };

  return (
    <Box
      sx={{
        width: '100%',
        p: 1.5,
        borderRadius: 1.5,
        border: 1,
        ...cardStyle,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mb: 1,
        }}
      >
        <TextField
          size="small"
          label={isDeduction ? 'Deduction type' : 'Payment name'}
          value={adjustment.label}
          onChange={(e) => onUpdateLabel(adjustment.id, e.target.value)}
          placeholder={isDeduction ? 'Subcontractor' : 'Adjustment'}
          sx={{ flex: 1, ...paymentFieldSx }}
        />
        <Chip
          size="small"
          variant={isDeduction ? 'filled' : adjustment.salesmanPaid ? 'filled' : 'outlined'}
          label={isDeduction ? 'Deduction' : adjustment.salesmanPaid ? 'Salesman paid' : 'Payment'}
          color={isDeduction ? 'warning' : adjustment.salesmanPaid ? 'success' : 'info'}
          sx={{ height: 22, fontSize: '0.7rem', flexShrink: 0 }}
        />
        <Tooltip title={isDeduction ? 'Remove deduction' : 'Remove adjustment'}>
          <IconButton
            size="small"
            color="error"
            aria-label={isDeduction ? 'Remove deduction' : 'Remove adjustment'}
            onClick={() => onRemove(adjustment.id)}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
        {isDeduction
          ? 'Reduces the commission balance without paying the salesman — e.g. subcontractor costs, write-offs.'
          : 'Manual payment outside the job payment schedule. Use negative amounts for paybacks.'}
      </Typography>
      {isDeduction ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            label="Note"
            value={adjustment.note}
            onChange={(e) => onUpdateNote(adjustment.id, e.target.value)}
            placeholder="e.g. Subcontractor paid from commission — job settled"
            multiline
            minRows={2}
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 1.5,
            }}
          >
            <TextField
              size="small"
              fullWidth
              label="Deduction amount"
              value={adjustment.displayAmount}
              onChange={(e) =>
                onUpdateAmount(adjustment.id, e.target.value.replace(/[^\d.]/g, ''))
              }
              placeholder="0.00"
              sx={paymentFieldSx}
              InputProps={{
                startAdornment: <InputAdornment position="start">$</InputAdornment>,
                inputProps: { inputMode: 'decimal' },
              }}
            />
            <TextField
              size="small"
              fullWidth
              type="date"
              label="Date"
              value={adjustment.date}
              onChange={(e) => onUpdateDate(adjustment.id, e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              md: 'minmax(140px, 1fr) minmax(148px, 1fr) minmax(120px, 1fr) auto',
            },
            gap: 1.5,
            alignItems: 'center',
          }}
        >
          <TextField
            size="small"
            fullWidth
            label="Commission amount"
            value={adjustment.displayAmount}
            onChange={(e) =>
              onUpdateAmount(adjustment.id, e.target.value.replace(/[^\d.-]/g, ''))
            }
            placeholder="0.00"
            sx={paymentFieldSx}
            InputProps={{
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
              inputProps: { inputMode: 'decimal' },
            }}
          />
          <TextField
            size="small"
            fullWidth
            type="date"
            label="Paid date"
            value={adjustment.date}
            onChange={(e) => onUpdateDate(adjustment.id, e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            fullWidth
            label="Check #"
            value={adjustment.check}
            onChange={(e) => onUpdateCheck(adjustment.id, e.target.value)}
            placeholder="Check #"
            sx={paymentFieldSx}
          />
          <FormControlLabel
            sx={{ ml: 0, mr: 0, justifySelf: { md: 'start' } }}
            control={
              <Checkbox
                size="small"
                checked={adjustment.salesmanPaid}
                onChange={(e) => onUpdateSalesmanPaid(adjustment.id, e.target.checked)}
              />
            }
            label={
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Salesman paid
              </Typography>
            }
          />
        </Box>
      )}
    </Box>
  );
}

interface CommissionAdjustmentsSectionProps {
  adjustments: CommissionAdjustmentDisplay[];
  onAddPayment: () => void;
  onAddDeduction: () => void;
  onUpdateLabel: (id: string, value: string) => void;
  onUpdateNote: (id: string, value: string) => void;
  onUpdateAmount: (id: string, value: string) => void;
  onUpdateDate: (id: string, value: string) => void;
  onUpdateCheck: (id: string, value: string) => void;
  onUpdateSalesmanPaid: (id: string, paid: boolean) => void;
  onRemove: (id: string) => void;
}

function CommissionAdjustmentsSection({
  adjustments,
  onAddPayment,
  onAddDeduction,
  onUpdateLabel,
  onUpdateNote,
  onUpdateAmount,
  onUpdateDate,
  onUpdateCheck,
  onUpdateSalesmanPaid,
  onRemove,
}: CommissionAdjustmentsSectionProps) {
  return (
    <Box sx={{ mt: 3, pt: 2.5, borderTop: 1, borderColor: 'divider' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          mb: adjustments.length > 0 ? 2 : 1,
          flexWrap: 'wrap',
        }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Adjustments
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Extra payments to the salesman, or deductions that reduce the balance (subcontractor, write-off).
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={onAddPayment}
            sx={{ textTransform: 'none' }}
          >
            Add payment
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="warning"
            startIcon={<AddIcon />}
            onClick={onAddDeduction}
            sx={{ textTransform: 'none' }}
          >
            Add deduction
          </Button>
        </Box>
      </Box>
      {adjustments.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No adjustments yet.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {adjustments.map((adjustment) => (
            <AdjustmentPaymentCard
              key={adjustment.id}
              adjustment={adjustment}
              onUpdateLabel={onUpdateLabel}
              onUpdateNote={onUpdateNote}
              onUpdateAmount={onUpdateAmount}
              onUpdateDate={onUpdateDate}
              onUpdateCheck={onUpdateCheck}
              onUpdateSalesmanPaid={onUpdateSalesmanPaid}
              onRemove={onRemove}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

interface SettleRemainderBannerProps {
  balance: number;
  onSettle: () => void;
}

function SettleRemainderBanner({ balance, onSettle }: SettleRemainderBannerProps) {
  const theme = useTheme();
  if (balance <= 0.01) return null;

  return (
    <Box
      sx={{
        mt: 2.5,
        p: 2,
        borderRadius: 1.5,
        border: 1,
        borderColor: 'warning.main',
        bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.08),
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Remaining balance: {formatMoney(balance)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        All commission tiers may be paid, but something reduced what is owed — like a subcontractor
        taken from commission. Record a deduction to settle this job without paying the salesman
        again.
      </Typography>
      <Button variant="contained" color="warning" size="small" onClick={onSettle} sx={{ textTransform: 'none' }}>
        Settle remainder…
      </Button>
    </Box>
  );
}

interface SettleRemainderDialogProps {
  open: boolean;
  balance: number;
  onClose: () => void;
  onConfirm: (payload: { amount: string; label: string; note: string; date: string }) => void;
}

function SettleRemainderDialog({ open, balance, onClose, onConfirm }: SettleRemainderDialogProps) {
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('Subcontractor');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    if (!open) return;
    setAmount(balance > 0 ? formatMoneyInput(balance) : '');
    setLabel('Subcontractor');
    setNote('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
  }, [open, balance]);

  const handleConfirm = () => {
    if (!note.trim()) return;
    onConfirm({ amount, label, note: note.trim(), date });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Settle remainder</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Records a deduction so the commission balance goes to zero. This does not pay the salesman
          — it documents why the remaining amount is not owed.
        </Typography>
        <TextField
          fullWidth
          size="small"
          label="Deduction type"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          size="small"
          label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          sx={{ mb: 2, ...paymentFieldSx }}
          InputProps={{
            startAdornment: <InputAdornment position="start">$</InputAdornment>,
            inputProps: { inputMode: 'decimal' },
          }}
        />
        <TextField
          fullWidth
          size="small"
          type="date"
          label="Date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          size="small"
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Subcontractor paid from commission — job fully settled"
          multiline
          minRows={3}
          required
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="warning" onClick={handleConfirm} disabled={!note.trim()}>
          Settle job
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface JobPaymentCardsProps {
  row: CommissionTableRow;
  layout?: 'vertical' | 'horizontal';
  preserveOrder?: boolean;
  onReorder: (jobId: string, order: number[]) => void;
  onUpdateAmount: (jobId: string, scheduleIndex: number, value: string) => void;
  onUpdateDate: (jobId: string, scheduleIndex: number, value: string) => void;
  onUpdateCheck: (jobId: string, scheduleIndex: number, value: string) => void;
  onUpdateSalesmanPaid: (jobId: string, scheduleIndex: number, paid: boolean) => void;
  onResetOverrides: (jobId: string) => void;
}

function JobPaymentCards({
  row,
  layout = 'horizontal',
  preserveOrder = false,
  onReorder,
  onUpdateAmount,
  onUpdateDate,
  onUpdateCheck,
  onUpdateSalesmanPaid,
  onResetOverrides,
}: JobPaymentCardsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const isVertical = layout === 'vertical';

  const orderedPayments = preserveOrder
    ? orderPaymentsForDisplay(row.payments, row.paymentOrder, { preserveOrder: true })
    : row.payments;

  const activePayments = preserveOrder
    ? orderedPayments
    : row.payments.filter((payment) => !payment.salesmanPaid);
  const settledPayments = preserveOrder
    ? []
    : row.payments.filter((payment) => payment.salesmanPaid);

  const sortablePayments = preserveOrder ? orderedPayments : activePayments;
  const sortableIds = sortablePayments.map((payment) => `${row.jobId}-${payment.scheduleIndex}`);
  const sortStrategy = isVertical ? verticalListSortingStrategy : horizontalListSortingStrategy;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeIdx = sortableIds.indexOf(String(active.id));
    const overIdx = sortableIds.indexOf(String(over.id));
    if (activeIdx < 0 || overIdx < 0) return;

    const currentOrder = sortablePayments.map((payment) => payment.scheduleIndex);
    const nextOrder = arrayMove(currentOrder, activeIdx, overIdx);
    onReorder(row.jobId, nextOrder);
  };

  const renderPaymentCard = (payment: CommissionPaymentDisplay, draggable: boolean, keySuffix = '') => (
    <SortablePaymentCard
      key={`${row.jobId}-${payment.scheduleIndex}${keySuffix}`}
      payment={payment}
      jobId={row.jobId}
      layout={layout}
      draggable={draggable}
      onUpdateAmount={(scheduleIndex, value) => onUpdateAmount(row.jobId, scheduleIndex, value)}
      onUpdateDate={(scheduleIndex, value) => onUpdateDate(row.jobId, scheduleIndex, value)}
      onUpdateCheck={(scheduleIndex, value) => onUpdateCheck(row.jobId, scheduleIndex, value)}
      onUpdateSalesmanPaid={(scheduleIndex, paid) =>
        onUpdateSalesmanPaid(row.jobId, scheduleIndex, paid)
      }
    />
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        alignItems: 'flex-start',
        gap: isVertical ? 1.5 : 1,
        pb: 0.5,
        width: isVertical ? '100%' : 'max-content',
      }}
    >
      {preserveOrder ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={sortStrategy}>
            {orderedPayments.map((payment) => renderPaymentCard(payment, true))}
          </SortableContext>
        </DndContext>
      ) : (
        <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={sortStrategy}>
          {activePayments.map((payment) => renderPaymentCard(payment, true))}
        </SortableContext>
      </DndContext>
      {settledPayments.map((payment) => renderPaymentCard(payment, false, '-settled'))}
        </>
      )}
      {row.hasManualPayments && (
        <Tooltip title="Reset manual amounts to job payment status">
          <IconButton
            size="small"
            onClick={() => onResetOverrides(row.jobId)}
            aria-label="Reset payment overrides"
            sx={{ mt: 0.5 }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

interface CommissionPaymentModalProps {
  row: CommissionTableRow | null;
  open: boolean;
  dirty: boolean;
  saving: boolean;
  onClose: () => void;
  onCancel: () => void;
  onSave: () => void;
  onClearRateOverride: (jobId: string) => void;
  onUpdateRate: (jobId: string, value: string) => void;
  onReorder: (jobId: string, order: number[]) => void;
  onUpdateAmount: (jobId: string, scheduleIndex: number, value: string) => void;
  onUpdateDate: (jobId: string, scheduleIndex: number, value: string) => void;
  onUpdateCheck: (jobId: string, scheduleIndex: number, value: string) => void;
  onUpdateSalesmanPaid: (jobId: string, scheduleIndex: number, paid: boolean) => void;
  onResetOverrides: (jobId: string) => void;
  onAddAdjustment: (jobId: string) => void;
  onAddDeduction: (jobId: string) => void;
  onSettleRemainder: (
    jobId: string,
    payload: { amount: string; label: string; note: string; date: string },
  ) => void;
  onUpdateAdjustmentLabel: (jobId: string, adjustmentId: string, value: string) => void;
  onUpdateAdjustmentNote: (jobId: string, adjustmentId: string, value: string) => void;
  onUpdateAdjustmentAmount: (jobId: string, adjustmentId: string, value: string) => void;
  onUpdateAdjustmentDate: (jobId: string, adjustmentId: string, value: string) => void;
  onUpdateAdjustmentCheck: (jobId: string, adjustmentId: string, value: string) => void;
  onUpdateAdjustmentSalesmanPaid: (jobId: string, adjustmentId: string, paid: boolean) => void;
  onRemoveAdjustment: (jobId: string, adjustmentId: string) => void;
  onOpenJobDetail: (jobId: string) => void;
}

function CommissionPaymentModal({
  row,
  open,
  dirty,
  saving,
  onClose,
  onCancel,
  onSave,
  onClearRateOverride,
  onUpdateRate,
  onReorder,
  onUpdateAmount,
  onUpdateDate,
  onUpdateCheck,
  onUpdateSalesmanPaid,
  onResetOverrides,
  onAddAdjustment,
  onAddDeduction,
  onSettleRemainder,
  onUpdateAdjustmentLabel,
  onUpdateAdjustmentNote,
  onUpdateAdjustmentAmount,
  onUpdateAdjustmentDate,
  onUpdateAdjustmentCheck,
  onUpdateAdjustmentSalesmanPaid,
  onRemoveAdjustment,
  onOpenJobDetail,
}: CommissionPaymentModalProps) {
  const theme = useTheme();
  const [settleDialogOpen, setSettleDialogOpen] = useState(false);

  if (!row) return null;

  const balanceColor = isCommissionOverpaid(row)
    ? 'error.main'
    : row.balance <= 0.01
      ? 'success.main'
      : 'text.primary';

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          minHeight: { xs: '88vh', sm: '80vh' },
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle
        sx={{
          pr: 6,
          pt: 2.5,
          pb: 2,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {row.customerName}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {row.jobLabel || 'Untitled'} · {row.stageLabel || '-'}
          </Typography>
        </Box>
        <Tooltip title="View job">
          <IconButton
            aria-label="View job"
            onClick={() => onOpenJobDetail(row.jobId)}
            sx={{ position: 'absolute', right: 48, top: 12 }}
          >
            <PersonIcon />
          </IconButton>
        </Tooltip>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 12 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          px: { xs: 2, sm: 3 },
          py: 2.5,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 3,
            mb: 3,
            alignItems: 'flex-end',
            p: 2,
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              Job total
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              {formatMoney(row.jobTotal)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Deposited
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              {row.depositedTotal > 0 ? formatMoney(row.depositedTotal) : '—'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Rate
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TextField
                size="small"
                value={row.commissionRate}
                onChange={(e) => onUpdateRate(row.jobId, e.target.value)}
                InputProps={{
                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                  inputProps: { inputMode: 'decimal', min: 0, step: 0.1 },
                }}
                sx={{ width: 96, ...paymentFieldSx }}
              />
              {row.rateOverridden && (
                <Tooltip title="Use default rate">
                  <IconButton
                    size="small"
                    onClick={() => onClearRateOverride(row.jobId)}
                    aria-label="Reset rate to default"
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Commission
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              {formatMoney(row.commissionDue)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Paid to salesman
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              {formatMoney(row.paidToSalesman)}
            </Typography>
          </Box>
          {row.deductionTotal > 0.005 && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Deductions
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 700, color: 'warning.main' }}>
                {formatMoney(row.deductionTotal)}
              </Typography>
            </Box>
          )}
          <Box>
            <Typography variant="caption" color="text.secondary">
              {isCommissionOverpaid(row) ? 'Overpaid (owed back)' : 'Balance'}
            </Typography>
            <Typography
              variant="body1"
              sx={{
                fontWeight: 700,
                color: balanceColor,
              }}
            >
              {formatMoney(row.balance)}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', width: '100%', minHeight: 0, pr: 0.5 }}>
          <JobPaymentCards
            row={row}
            layout="vertical"
            preserveOrder
            onReorder={onReorder}
            onUpdateAmount={onUpdateAmount}
            onUpdateDate={onUpdateDate}
            onUpdateCheck={onUpdateCheck}
            onUpdateSalesmanPaid={onUpdateSalesmanPaid}
            onResetOverrides={onResetOverrides}
          />
          <SettleRemainderBanner
            balance={row.balance}
            onSettle={() => setSettleDialogOpen(true)}
          />
          <CommissionAdjustmentsSection
            adjustments={row.adjustments}
            onAddPayment={() => onAddAdjustment(row.jobId)}
            onAddDeduction={() => onAddDeduction(row.jobId)}
            onUpdateLabel={(id, value) => onUpdateAdjustmentLabel(row.jobId, id, value)}
            onUpdateNote={(id, value) => onUpdateAdjustmentNote(row.jobId, id, value)}
            onUpdateAmount={(id, value) => onUpdateAdjustmentAmount(row.jobId, id, value)}
            onUpdateDate={(id, value) => onUpdateAdjustmentDate(row.jobId, id, value)}
            onUpdateCheck={(id, value) => onUpdateAdjustmentCheck(row.jobId, id, value)}
            onUpdateSalesmanPaid={(id, paid) =>
              onUpdateAdjustmentSalesmanPaid(row.jobId, id, paid)
            }
            onRemove={(id) => onRemoveAdjustment(row.jobId, id)}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        {dirty ? (
          <Typography variant="caption" color="warning.main" sx={{ mr: 'auto' }}>
            Unsaved changes
          </Typography>
        ) : (
          <Box sx={{ mr: 'auto' }} />
        )}
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={onSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>

    <SettleRemainderDialog
      open={settleDialogOpen}
      balance={row.balance}
      onClose={() => setSettleDialogOpen(false)}
      onConfirm={(payload) => {
        onSettleRemainder(row.jobId, payload);
        setSettleDialogOpen(false);
      }}
    />
    </>
  );
}

function CommissionLogsPage() {
  const { tenantIdForBranding } = useAuth();
  const isMobile = useIsMobile();
  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const [loadingCommissionLogs, setLoadingCommissionLogs] = useState(false);
  const [commissionSourceJobs, setCommissionSourceJobs] = useState<CommissionSourceJobRow[]>([]);
  const [defaultCommissionRate, setDefaultCommissionRate] = useState(() => readDefaultCommissionRate());
  const [defaultRateInput, setDefaultRateInput] = useState(() => String(readDefaultCommissionRate()));
  const [inheritedRates, setInheritedRates] = useState<Record<string, number>>(
    () => readInheritedCommissionRates(),
  );
  const [overviewJobOrder, setOverviewJobOrder] = useState<string[]>(() => readOverviewJobOrder());
  const [showZeroCommissionJobs, setShowZeroCommissionJobs] = useState(() => readShowZeroCommissionJobs());
  const [pageTab, setPageTab] = useState<CommissionPageTab>(() => readCommissionPageTab());
  const [paymentModalJobId, setPaymentModalJobId] = useState<string | null>(null);
  const [paymentModalDraft, setPaymentModalDraft] = useState<CommissionLogLocalRow | null>(null);
  const [paymentModalDirty, setPaymentModalDirty] = useState(false);
  const [paymentModalSaving, setPaymentModalSaving] = useState(false);
  const [jobDetailModalJobId, setJobDetailModalJobId] = useState<string | null>(null);
  const [setPaidDialogGroup, setSetPaidDialogGroup] = useState<CommissionCheckGroup | null>(null);
  const [editCheckDialogGroup, setEditCheckDialogGroup] = useState<CommissionCheckGroup | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [commissionLogRows, setCommissionLogRows] = useState<Record<string, CommissionLogLocalRow>>(
    () => readCommissionLogRows(),
  );
  const loadRequestIdRef = useRef(0);

  const applyCheckGroupChanges = useCallback(
    (
      group: CommissionCheckGroup,
      check: string,
      paidDate: string,
      options: { markSalesmanPaid: boolean; successMessage: string; onDone: () => void },
    ) => {
      const trimmedCheck = String(check || '').trim();
      if (!trimmedCheck) {
        toast.error('Enter a check number');
        return;
      }

      const resolvedDate = String(paidDate || group.date || '').trim();

      setCommissionLogRows((prev) => {
        const next = { ...prev };
        const updatesByJob = new Map<string, CommissionCheckEntry[]>();

        for (const entry of group.entries) {
          const list = updatesByJob.get(entry.jobId) || [];
          list.push(entry);
          updatesByJob.set(entry.jobId, list);
        }

        for (const [jobId, jobEntries] of updatesByJob) {
          let current = migrateLocalRow(next[jobId] || {});
          current = applyCheckGroupUpdates(current, jobEntries, {
            check: trimmedCheck,
            paidDate: resolvedDate,
            markSalesmanPaid: options.markSalesmanPaid,
          });

          const nextRow: CommissionLogLocalRow = {
            ...current,
            updatedAt: new Date().toISOString(),
          };
          next[jobId] = nextRow;
          void persistCommissionLog(jobId, nextRow).catch((error) => {
            console.error('Failed to save commission log:', error);
            toast.error('Failed to save commission log');
          });
        }

        return next;
      });

      toast.success(options.successMessage);
      options.onDone();
    },
    [],
  );

  const markCheckGroupPaid = useCallback(
    (group: CommissionCheckGroup, check: string, paidDate: string) => {
      applyCheckGroupChanges(group, check, paidDate, {
        markSalesmanPaid: true,
        successMessage: `Marked ${group.entries.length} payment${group.entries.length === 1 ? '' : 's'} on check ${check.trim()}`,
        onDone: () => setSetPaidDialogGroup(null),
      });
    },
    [applyCheckGroupChanges],
  );

  const updateCheckGroupCheck = useCallback(
    (group: CommissionCheckGroup, check: string, paidDate: string) => {
      applyCheckGroupChanges(group, check, paidDate, {
        markSalesmanPaid: false,
        successMessage: `Updated check number for ${group.entries.length} payment${group.entries.length === 1 ? '' : 's'}`,
        onDone: () => setEditCheckDialogGroup(null),
      });
    },
    [applyCheckGroupChanges],
  );

  const updatePaymentModalDraft = useCallback(
    (updater: (draft: CommissionLogLocalRow) => CommissionLogLocalRow) => {
      setPaymentModalDraft((prev) => {
        if (!prev) return prev;
        return updater(prev);
      });
      setPaymentModalDirty(true);
    },
    [],
  );

  const updateModalCommissionRow = (jobId: string, patch: Partial<CommissionLogLocalRow>) => {
    if (jobId !== paymentModalJobId) return;
    updatePaymentModalDraft((current) => ({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  };

  const clearModalRateOverride = (jobId: string) => {
    if (jobId !== paymentModalJobId) return;
    setInheritedRates((prev) => ({ ...prev, [jobId]: defaultCommissionRate }));
    updatePaymentModalDraft((current) => {
      const next = { ...current };
      delete next.commissionRate;
      return { ...next, updatedAt: new Date().toISOString() };
    });
  };

  const updateModalCommissionPayment = (
    jobId: string,
    scheduleIndex: number,
    patch: Partial<CommissionPaymentLocal>,
    options?: { manual?: boolean },
  ) => {
    if (jobId !== paymentModalJobId) return;
    updatePaymentModalDraft((current) =>
      patchCommissionPaymentLocal(current, scheduleIndex, patch, options),
    );
  };

  const updateModalCommissionAdjustment = (
    jobId: string,
    adjustmentId: string,
    patch: Partial<CommissionAdjustmentLocal>,
  ) => {
    if (jobId !== paymentModalJobId) return;
    updatePaymentModalDraft((current) => {
      const adjustments = [...(current.adjustments || [])];
      const index = adjustments.findIndex((row) => row.id === adjustmentId);
      if (index < 0) return current;
      adjustments[index] = { ...adjustments[index], ...patch };
      return {
        ...current,
        adjustments,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const addModalCommissionAdjustment = (jobId: string) => {
    if (jobId !== paymentModalJobId) return;
    updatePaymentModalDraft((current) => ({
      ...current,
      adjustments: [...(current.adjustments || []), newAdjustmentRow()],
      updatedAt: new Date().toISOString(),
    }));
  };

  const addModalCommissionDeduction = (jobId: string) => {
    if (jobId !== paymentModalJobId) return;
    updatePaymentModalDraft((current) => ({
      ...current,
      adjustments: [...(current.adjustments || []), newDeductionRow()],
      updatedAt: new Date().toISOString(),
    }));
  };

  const settleModalCommissionRemainder = (
    jobId: string,
    payload: { amount: string; label: string; note: string; date: string },
  ) => {
    if (jobId !== paymentModalJobId) return;
    updatePaymentModalDraft((current) => {
      const deduction: CommissionAdjustmentLocal = {
        ...newDeductionRow(payload.amount, payload.note),
        label: payload.label.trim() || 'Deduction',
        note: payload.note,
        date: payload.date,
      };
      return {
        ...current,
        adjustments: [...(current.adjustments || []), deduction],
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const removeModalCommissionAdjustment = (jobId: string, adjustmentId: string) => {
    if (jobId !== paymentModalJobId) return;
    updatePaymentModalDraft((current) => ({
      ...current,
      adjustments: (current.adjustments || []).filter((row) => row.id !== adjustmentId),
      updatedAt: new Date().toISOString(),
    }));
  };

  const reorderModalPayments = (jobId: string, order: number[]) => {
    updateModalCommissionRow(jobId, { paymentOrder: order });
  };

  const handleModalPaymentAmountChange = (jobId: string, scheduleIndex: number, value: string) => {
    updateModalCommissionPayment(jobId, scheduleIndex, { amount: value }, { manual: true });
  };

  const handleModalSalesmanPaidChange = (jobId: string, scheduleIndex: number, paid: boolean) => {
    updateModalCommissionPayment(jobId, scheduleIndex, { salesmanPaid: paid });
  };

  const resetModalPaymentOverrides = (jobId: string) => {
    updateModalCommissionRow(jobId, { payments: [], paymentOrder: [] });
  };

  const handleModalUpdateRate = (jobId: string, value: string) => {
    if (value === '') {
      clearModalRateOverride(jobId);
    } else {
      updateModalCommissionRow(jobId, { commissionRate: value });
    }
  };

  const handleClosePaymentModal = () => {
    if (paymentModalDirty) {
      if (!window.confirm('Discard unsaved payment changes?')) return;
    }
    setPaymentModalJobId(null);
  };

  const handleSavePaymentModal = async () => {
    if (!paymentModalJobId || !paymentModalDraft || !paymentModalDirty) return;
    setPaymentModalSaving(true);
    try {
      const nextRow: CommissionLogLocalRow = {
        ...paymentModalDraft,
        updatedAt: new Date().toISOString(),
      };
      setCommissionLogRows((prev) => ({
        ...prev,
        [paymentModalJobId]: nextRow,
      }));
      await persistCommissionLog(paymentModalJobId, nextRow);
      setPaymentModalDirty(false);
    } catch (error) {
      console.error('Failed to save commission log:', error);
      toast.error('Failed to save commission log');
    } finally {
      setPaymentModalSaving(false);
    }
  };

  const commissionTableRows = useMemo((): CommissionTableRow[] => {
    return commissionSourceJobs.map((row) =>
      buildCommissionTableRow(
        row,
        commissionLogRows[String(row.jobId)] || {},
        inheritedRates[String(row.jobId)] ?? defaultCommissionRate,
      ),
    );
  }, [commissionSourceJobs, commissionLogRows, inheritedRates, defaultCommissionRate]);

  const overviewTableRows = useMemo(
    () => applyOverviewJobOrder(commissionTableRows, overviewJobOrder),
    [commissionTableRows, overviewJobOrder],
  );

  const filteredJobRows = useMemo(() => {
    const searched = overviewTableRows.filter((row) => matchesCommissionSearch(row, searchQuery));
    if (showZeroCommissionJobs) return searched;
    return searched.filter((row) => !isZeroCommissionJob(row));
  }, [overviewTableRows, searchQuery, showZeroCommissionJobs]);

  const visibleTableRows = filteredJobRows;

  const checkSourceRows = useMemo(() => {
    if (showZeroCommissionJobs) return commissionTableRows;
    return commissionTableRows.filter((row) => !isZeroCommissionJob(row));
  }, [commissionTableRows, showZeroCommissionJobs]);

  const checkEntries = useMemo(
    () => buildCheckEntries(checkSourceRows),
    [checkSourceRows],
  );

  const salesmanPaidEntries = useMemo(
    () => buildSalesmanPaidEntries(checkSourceRows),
    [checkSourceRows],
  );

  const filteredSalesmanPaidEntries = useMemo(
    () => salesmanPaidEntries.filter((entry) => matchesSalesmanPaidSearch(entry, searchQuery)),
    [salesmanPaidEntries, searchQuery],
  );

  const salesmanPaidTotal = useMemo(
    () => roundMoney(filteredSalesmanPaidEntries.reduce((sum, entry) => sum + entry.amount, 0)),
    [filteredSalesmanPaidEntries],
  );

  const checkGroups = useMemo(() => groupCheckEntries(checkEntries), [checkEntries]);

  const filteredCheckGroups = useMemo(
    () => checkGroups.filter((group) => matchesCheckGroup(group, searchQuery)),
    [checkGroups, searchQuery],
  );

  const checkEntriesTotal = useMemo(
    () => roundMoney(filteredCheckGroups.reduce((sum, group) => sum + group.totalAmount, 0)),
    [filteredCheckGroups],
  );

  const filteredCheckPaymentsCount = useMemo(
    () => filteredCheckGroups.reduce((sum, group) => sum + group.entries.length, 0),
    [filteredCheckGroups],
  );

  const paymentModalRow = useMemo(() => {
    if (!paymentModalJobId || !paymentModalDraft) return null;
    const source = commissionSourceJobs.find((row) => row.jobId === paymentModalJobId);
    if (!source) return null;
    return buildCommissionTableRow(
      source,
      paymentModalDraft,
      inheritedRates[paymentModalJobId] ?? defaultCommissionRate,
    );
  }, [paymentModalJobId, paymentModalDraft, commissionSourceJobs, inheritedRates, defaultCommissionRate]);

  useEffect(() => {
    if (!paymentModalJobId) {
      setPaymentModalDraft(null);
      setPaymentModalDirty(false);
      setPaymentModalSaving(false);
      return;
    }
    const current = commissionLogRows[paymentModalJobId] || {};
    setPaymentModalDraft(cloneCommissionLogRow(current));
    setPaymentModalDirty(false);
    setPaymentModalSaving(false);
  }, [paymentModalJobId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COMMISSION_LOGS_STORAGE_KEY, JSON.stringify(commissionLogRows || {}));
  }, [commissionLogRows]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DEFAULT_COMMISSION_RATE_KEY, String(defaultCommissionRate));
  }, [defaultCommissionRate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COMMISSION_INHERITED_RATES_KEY, JSON.stringify(inheritedRates));
  }, [inheritedRates]);

  useEffect(() => {
    if (commissionSourceJobs.length === 0 || defaultCommissionRate <= 0) return;
    setInheritedRates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const job of commissionSourceJobs) {
        const jobId = String(job.jobId);
        if (hasRateOverride(commissionLogRows[jobId] || {})) continue;
        if (next[jobId] == null) {
          next[jobId] = defaultCommissionRate;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [commissionSourceJobs, commissionLogRows, defaultCommissionRate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COMMISSION_OVERVIEW_JOB_ORDER_KEY, JSON.stringify(overviewJobOrder));
  }, [overviewJobOrder]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COMMISSION_SHOW_ZERO_RATE_KEY, String(showZeroCommissionJobs));
  }, [showZeroCommissionJobs]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COMMISSION_PAGE_TAB_KEY, pageTab);
  }, [pageTab]);

  const loadCommissionJobs = useCallback(async (
    signal?: { cancelled: boolean },
    options?: { background?: boolean },
  ) => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    // A slower earlier load must never overwrite the results of a newer one.
    const isStale = () => Boolean(signal?.cancelled) || requestId !== loadRequestIdRef.current;

    try {
      if (!options?.background) setLoadingCommissionLogs(true);
      const [jobs, estimatesData] = await Promise.all([
        fetchAllCommissionJobs(),
        axios.get<EstimateDoc[]>(`${API_URL}/estimates`),
      ]);
      if (isStale()) return;
      const estimates = Array.isArray(estimatesData.data) ? estimatesData.data : [];
      const latestEstimateByJob = pickLatestPositiveEstimateByJob(estimates);
      const localCache = readCommissionLogRows();
      const mergedCommissionRows: Record<string, CommissionLogLocalRow> = {};
      const migrations: Array<{ jobId: string; data: CommissionLogLocalRow }> = [];

      const rows: CommissionSourceJobRow[] = jobs
        .filter((job) => isCommissionEligibleJob(job))
        .map((job) => {
          const jobId = String(job?._id || '');
          const estimate = latestEstimateByJob.get(jobId);
          const fullAmount = resolveCommissionJobTotal(job, estimate);
          const merged = mergeCommissionLogRow(job?.commissionLog, localCache[jobId]);
          if (merged && hasCommissionLogData(merged)) {
            mergedCommissionRows[jobId] = merged;
            const dbRow = job?.commissionLog ? migrateLocalRow(job.commissionLog) : null;
            const localRow = localCache[jobId] ? migrateLocalRow(localCache[jobId]) : null;
            const shouldMigrate =
              !dbRow ||
              !hasCommissionLogData(dbRow) ||
              (localRow &&
                hasCommissionLogData(localRow) &&
                (Date.parse(String(localRow.updatedAt || '')) || 0) >
                  (Date.parse(String(dbRow.updatedAt || '')) || 0));
            if (shouldMigrate) {
              migrations.push({ jobId, data: merged });
            }
          }
          return {
            jobId,
            customerName:
              (typeof job?.customerId === 'object' && job?.customerId?.name) || 'Unknown customer',
            jobLabel: jobTitleAfterPipe(job?.title),
            assignedToName:
              (typeof job?.assignedTo === 'object' && job?.assignedTo?.name) ||
              String(job?.assignedTo || ''),
            stageLabel: ESTIMATE_STAGE_LABELS[job?.stage ?? ''] || String(job?.stage || ''),
            jobTotal: roundMoney(fullAmount),
            jobColor: job?.color,
            searchText: buildCommissionJobSearchText(job, roundMoney(fullAmount)),
            paymentSchedule: job?.paymentSchedule,
            contract: job?.contract,
            finalPayment: job?.finalPayment,
          };
        });
      setCommissionSourceJobs(rows);
      // Merge instead of replace. A reload only covers currently eligible jobs, so
      // replacing wholesale dropped every other job's commission log from state — and
      // the persist effect then wrote that truncated map over localStorage. Rows edited
      // while this request was in flight are kept by comparing updatedAt.
      setCommissionLogRows((prev) => {
        const next = { ...prev };
        for (const [jobId, incomingRow] of Object.entries(mergedCommissionRows)) {
          const currentRow = next[jobId];
          const currentAt = Date.parse(String(currentRow?.updatedAt || '')) || 0;
          const incomingAt = Date.parse(String(incomingRow?.updatedAt || '')) || 0;
          if (currentRow && currentAt > incomingAt) continue;
          next[jobId] = incomingRow;
        }
        return next;
      });

      if (migrations.length > 0) {
        void Promise.all(
          migrations.map(({ jobId, data }) =>
            persistCommissionLog(jobId, data).catch((error) => {
              console.error(`Failed to migrate commission log for job ${jobId}:`, error);
            }),
          ),
        );
      }
    } catch (error) {
      console.error('Error loading commission logs:', error);
      if (!isStale()) {
        setCommissionSourceJobs([]);
        const message =
          isAxiosError(error) &&
          error.response?.data &&
          typeof error.response.data === 'object' &&
          'error' in error.response.data
            ? String((error.response.data as { error?: unknown }).error ?? 'Failed to load commission logs')
            : 'Failed to load commission logs';
        toast.error(message);
      }
    } finally {
      if (!isStale()) setLoadingCommissionLogs(false);
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void loadCommissionJobs(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadCommissionJobs]);

  useEffect(() => {
    const signal = { cancelled: false };
    // Background refresh: no full-page spinner, and results are dropped if the page
    // unmounts or a newer load starts first.
    const handleFocus = () => {
      void loadCommissionJobs(signal, { background: true });
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      signal.cancelled = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadCommissionJobs]);

  useTenantRealtimeRefresh(tenantRoom, () => {
    void loadCommissionJobs(undefined, { background: true });
  });

  const handleJobDetailUpdate = async (jobId: string, updates: Record<string, unknown>) => {
    try {
      await axios.patch(`${API_URL}/jobs/${jobId}`, updates);
      toast.success('Job updated');
      await loadCommissionJobs();
    } catch (error) {
      console.error('Error updating job:', error);
      toast.error('Failed to update job');
    }
  };

  const handleJobDataChanged = () => {
    void loadCommissionJobs();
  };

  const handleJobDetailClose = async () => {
    setJobDetailModalJobId(null);
    await loadCommissionJobs();
  };

  return (
    <Box sx={{ width: '100%', maxWidth: '100%', py: 1 }}>
      <Card sx={{ width: '100%' }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 1.5,
              mb: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                Commission Logs
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {pageTab === 'recent'
                  ? 'Most recent salesman-paid commission payments — newest first. Click a row to open the job.'
                  : pageTab === 'checks'
                    ? 'Checks and cash grouped by number — right-click a group to mark paid or edit the check number.'
                    : 'Active jobs on top. At the bottom: underpaid (all tiers paid), then overpaid (red), then settled (green). Click a row to edit.'}
              </Typography>
            </Box>
            {/* Rate settings are desktop-only; phones just read the logs. */}
            {!isMobile && (
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={showZeroCommissionJobs}
                    onChange={(e) => setShowZeroCommissionJobs(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2" color="text.secondary">
                    Show 0% commission jobs
                  </Typography>
                }
              />
              <Tooltip title="Fallback for jobs that don't have their own rate yet. 13% and 15% jobs stay as they are — this does not filter the list.">
                <TextField
              size="small"
              label="Default rate"
              value={defaultRateInput}
              onChange={(e) => {
                const raw = e.target.value;
                setDefaultRateInput(raw);
                const parsed = parsePositiveCommissionRate(raw);
                if (parsed != null) setDefaultCommissionRate(parsed);
              }}
              onBlur={() => setDefaultRateInput(String(defaultCommissionRate))}
              InputProps={{
                endAdornment: <InputAdornment position="end">%</InputAdornment>,
                inputProps: { inputMode: 'decimal', min: 0.1, step: 0.1 },
              }}
              sx={{ width: 130 }}
            />
              </Tooltip>
            </Box>
            )}
          </Box>

          <Tabs
            value={pageTab}
            onChange={(_, value: CommissionPageTab) => setPageTab(value)}
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab value="checks" label="Checks / cash" />
            <Tab value="jobs" label="Jobs" />
            <Tab value="recent" label="Recent paid" />
          </Tabs>

          <TextField
            size="small"
            fullWidth
            label={
              pageTab === 'recent'
                ? 'Search recent paid'
                : pageTab === 'checks'
                  ? 'Search checks / cash'
                  : 'Search commission logs'
            }
            placeholder={
              pageTab === 'recent'
                ? 'Job, customer, payment, date, amount, balance, check #...'
                : pageTab === 'checks'
                  ? 'Customer, job, check #, cash, date, amount...'
                  : 'Customer, address, job, amount, payment, check #...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ mb: 2, maxWidth: 420 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
              endAdornment: searchQuery ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    edge="end"
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            }}
          />

          {loadingCommissionLogs ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : commissionTableRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No jobs found.
            </Typography>
          ) : pageTab === 'jobs' ? (
            visibleTableRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No jobs match &ldquo;{searchQuery.trim()}&rdquo;. Try a different search or clear the filter.
            </Typography>
          ) : (
            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
                overflow: 'auto',
                maxHeight: 'calc(100vh - 280px)',
              }}
            >
              <CommissionOverviewTable
                rows={visibleTableRows}
                onReorder={setOverviewJobOrder}
                onOpenPayments={(row) => setPaymentModalJobId(row.jobId)}
                onOpenJobDetail={setJobDetailModalJobId}
              />
            </Box>
          )
          ) : pageTab === 'recent' ? (
            filteredSalesmanPaidEntries.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {salesmanPaidEntries.length === 0
                  ? 'No salesman-paid commission payments recorded yet.'
                  : `No payments match "${searchQuery.trim()}". Try a different search or clear the filter.`}
              </Typography>
            ) : (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {filteredSalesmanPaidEntries.length} payment
                  {filteredSalesmanPaidEntries.length === 1 ? '' : 's'} · Total paid{' '}
                  {formatMoney(salesmanPaidTotal)}
                </Typography>
                <Box
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    overflow: 'auto',
                    maxHeight: 'calc(100vh - 300px)',
                  }}
                >
                  <RecentSalesmanPaidTable
                    entries={filteredSalesmanPaidEntries}
                    onOpenJob={(jobId) => setPaymentModalJobId(jobId)}
                    onOpenJobDetail={setJobDetailModalJobId}
                  />
                </Box>
              </Box>
            )
          ) : filteredCheckGroups.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {checkEntries.length === 0
                ? 'No checks or cash payments recorded yet.'
                : `No checks match "${searchQuery.trim()}". Try a different search or clear the filter.`}
            </Typography>
          ) : (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {filteredCheckGroups.length} check{filteredCheckGroups.length === 1 ? '' : 's'} ·{' '}
                {filteredCheckPaymentsCount} payment{filteredCheckPaymentsCount === 1 ? '' : 's'} ·{' '}
                Total {formatMoney(checkEntriesTotal)}
              </Typography>
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  overflow: 'auto',
                  maxHeight: 'calc(100vh - 300px)',
                }}
              >
                <CommissionChecksTable
                  groups={filteredCheckGroups}
                  onOpenJob={(jobId) => setPaymentModalJobId(jobId)}
                  onOpenJobDetail={setJobDetailModalJobId}
                  onSetGroupPaid={setSetPaidDialogGroup}
                  onEditGroupCheck={setEditCheckDialogGroup}
                />
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      <CheckGroupDialog
        group={setPaidDialogGroup}
        open={Boolean(setPaidDialogGroup)}
        mode="pay"
        onClose={() => setSetPaidDialogGroup(null)}
        onConfirm={(check, paidDate) => {
          if (setPaidDialogGroup) markCheckGroupPaid(setPaidDialogGroup, check, paidDate);
        }}
      />

      <CheckGroupDialog
        group={editCheckDialogGroup}
        open={Boolean(editCheckDialogGroup)}
        mode="edit"
        onClose={() => setEditCheckDialogGroup(null)}
        onConfirm={(check, paidDate) => {
          if (editCheckDialogGroup) updateCheckGroupCheck(editCheckDialogGroup, check, paidDate);
        }}
      />

      <CommissionPaymentModal
        row={paymentModalRow}
        open={Boolean(paymentModalJobId && paymentModalRow)}
        dirty={paymentModalDirty}
        saving={paymentModalSaving}
        onClose={handleClosePaymentModal}
        onCancel={handleClosePaymentModal}
        onSave={() => void handleSavePaymentModal()}
        onClearRateOverride={clearModalRateOverride}
        onUpdateRate={handleModalUpdateRate}
        onReorder={reorderModalPayments}
        onUpdateAmount={handleModalPaymentAmountChange}
        onUpdateDate={(jobId, scheduleIndex, value) =>
          updateModalCommissionPayment(jobId, scheduleIndex, { date: value })
        }
        onUpdateCheck={(jobId, scheduleIndex, value) =>
          updateModalCommissionPayment(jobId, scheduleIndex, { check: value })
        }
        onUpdateSalesmanPaid={handleModalSalesmanPaidChange}
        onResetOverrides={resetModalPaymentOverrides}
        onAddAdjustment={addModalCommissionAdjustment}
        onAddDeduction={addModalCommissionDeduction}
        onSettleRemainder={settleModalCommissionRemainder}
        onUpdateAdjustmentLabel={(jobId, adjustmentId, value) =>
          updateModalCommissionAdjustment(jobId, adjustmentId, { label: value })
        }
        onUpdateAdjustmentNote={(jobId, adjustmentId, value) =>
          updateModalCommissionAdjustment(jobId, adjustmentId, { note: value })
        }
        onUpdateAdjustmentAmount={(jobId, adjustmentId, value) =>
          updateModalCommissionAdjustment(jobId, adjustmentId, { amount: value })
        }
        onUpdateAdjustmentDate={(jobId, adjustmentId, value) =>
          updateModalCommissionAdjustment(jobId, adjustmentId, { date: value })
        }
        onUpdateAdjustmentCheck={(jobId, adjustmentId, value) =>
          updateModalCommissionAdjustment(jobId, adjustmentId, { check: value })
        }
        onUpdateAdjustmentSalesmanPaid={(jobId, adjustmentId, paid) =>
          updateModalCommissionAdjustment(jobId, adjustmentId, { salesmanPaid: paid })
        }
        onRemoveAdjustment={removeModalCommissionAdjustment}
        onOpenJobDetail={setJobDetailModalJobId}
      />

      <JobDetailModal
        jobId={jobDetailModalJobId}
        open={Boolean(jobDetailModalJobId)}
        onClose={() => setJobDetailModalJobId(null)}
        onJobUpdate={handleJobDetailUpdate}
        onJobDataChanged={handleJobDataChanged}
        onJobDelete={handleJobDetailClose}
        onJobArchive={handleJobDetailClose}
      />
    </Box>
  );
}

export default CommissionLogsPage;
