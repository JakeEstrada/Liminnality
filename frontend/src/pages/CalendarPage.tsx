/**
 * CalendarPage — Install calendar: bench, scheduled jobs, appointments.
 * Routes: /calendar, /calendar-view (TV mode)
 * APIs: GET /jobs, GET/POST /appointments
 * Docs: ../../../docs/PAGES.md#calendarpagetsx
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Chip,
  CircularProgress,
  Card,
  CardContent,
  Menu,
  ListItemIcon,
  ListItemText,
  useTheme,
  useMediaQuery,
  Autocomplete,
  Tooltip,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Close as CloseIcon,
  Today as TodayIcon,
  CheckCircle as CheckCircleIcon,
  DragIndicator as DragIndicatorIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  Person as PersonIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Settings as SettingsIcon,
  Share as ShareIcon,
  Print as PrintIcon,
} from '@mui/icons-material';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, startOfWeek, endOfWeek, isSameDay, addDays } from 'date-fns';
import axios, { isAxiosError } from 'axios';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import JobDetailModal from '../components/jobs/JobDetailModal';
import { useSocketSubscription } from '../hooks/useSocketSubscription';
import { getConnectedSocketId, getTenantRoom } from '../services/socket';
import { applyJobRealtimeToList, isActiveCalendarJob } from '../utils/realtimeJobs';
import { useShopViewSensitive } from '../hooks/useShopViewSensitive';
import { useFinancialPinLockContext } from '../context/FinancialPinLockContext';
import EmployeeSmsRecipientField, {
  parseSmsRecipientSelection,
} from '../components/common/EmployeeSmsRecipientField';
import { formatPhoneForDisplay, nanpDigitsOnly } from '../utils/phoneFormat';
import { buildCustomerShareMessage } from '../utils/customerShareMessage';
import { buildCalendarBenchPrintData, writeCalendarBenchPrintData } from '../utils/calendarBenchPrint';
import { buildCalendarMonthsPrintData, writeCalendarMonthsPrintData } from '../utils/calendarMonthsPrint';
import { jobSiteAddress } from '../utils/jobGeo';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CALENDAR_HIDDEN_WEEKDAYS_KEY = 'calendarHiddenWeekdays';
const CALENDAR_BENCH_POSITION_KEY = 'calendarBenchPosition';
const DEFAULT_BENCH_JOB_COLOR = '#1976D2';
const CALENDAR_INSTALLER_ORDER_KEY = 'calendarInstallerOrder';

// Default installer order used for calendar lanes and suggestions
const DEFAULT_INSTALLER_ORDER = [
  'Nick',
  'Ed',
  'Eder',
  'Daniel',
  'Moris',
  'Hayden'
];

function normalizeInstallerOrder(names) {
  const seen = new Set();
  return (Array.isArray(names) ? names : [])
    .map((n) => String(n || '').trim())
    .filter((n) => {
      if (!n) return false;
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function toISODate(year, month, day) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const first = new Date(year, monthIndex, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, monthIndex, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const last = new Date(year, monthIndex + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, monthIndex, last.getDate() - offset);
}

function buildMajorUSHolidayMap(year) {
  const map = {};
  map[toISODate(year, 1, 1)] = "New Year's Day";
  map[format(nthWeekdayOfMonth(year, 0, 1, 3), 'yyyy-MM-dd')] = 'Martin Luther King Jr. Day';
  map[format(nthWeekdayOfMonth(year, 1, 1, 3), 'yyyy-MM-dd')] = "Presidents' Day";
  map[format(lastWeekdayOfMonth(year, 4, 1), 'yyyy-MM-dd')] = 'Memorial Day';
  map[toISODate(year, 6, 19)] = 'Juneteenth';
  map[toISODate(year, 7, 4)] = 'Independence Day';
  map[format(nthWeekdayOfMonth(year, 8, 1, 1), 'yyyy-MM-dd')] = 'Labor Day';
  map[format(nthWeekdayOfMonth(year, 10, 4, 4), 'yyyy-MM-dd')] = 'Thanksgiving';
  map[toISODate(year, 12, 25)] = 'Christmas Day';
  return map;
}

// Anonymous Gregorian computus for Easter Sunday
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getHolidayChipLabel(label, tvMode) {
  if (!label) return '';
  if (!tvMode) return label;
  const shortMap = {
    "New Year's Day": 'New Year',
    'Martin Luther King Jr. Day': 'MLK Day',
    "Presidents' Day": "Presidents'",
    'Memorial Day': 'Memorial',
    Juneteenth: 'Juneteenth',
    'Independence Day': 'Independence',
    'Labor Day': 'Labor',
    Thanksgiving: 'Thanksgiving',
    'Christmas Day': 'Christmas',
    Easter: 'Easter',
  };
  return shortMap[label] || label.replace(/\s+Day$/i, '');
}

// Event creation/edit modal
function EventModal({ open, onClose, selectedDate, job, onSave, onViewJob, installerOptions = [], selectedInstaller = '' }) {
  const theme = useTheme();
  const GROUP_ACCENTS = ['#1976D2', '#9C27B0', '#FF9800', '#4CAF50', '#3F51B5'];
  const getGroupAccent = (idx) => GROUP_ACCENTS[idx % GROUP_ACCENTS.length];
  const newEntryLocalId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const withEntryLocalIds = (entries = []) =>
    entries.map((entry) => ({
      ...entry,
      _localId: entry?._localId || newEntryLocalId(),
    }));
  const isCompleteIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const PAST_YEAR_CONFIRM_MESSAGE = 'Are you sure you want to edit an event from this time?';
  const isBeforeCurrentYear = (value) => {
    if (!isCompleteIsoDate(value)) return false;
    const year = Number(String(value).slice(0, 4));
    return Number.isFinite(year) && year < new Date().getFullYear();
  };
  const entriesHavePastYearDates = (entries = []) =>
    entries.some(
      (entry) => isBeforeCurrentYear(entry?.startDate) || isBeforeCurrentYear(entry?.endDate)
    );
  const sortScheduleEntries = (entries = []) =>
    [...entries].sort((a, b) => {
      const aDate = isCompleteIsoDate(a?.startDate)
        ? new Date(`${a.startDate}T00:00:00`).getTime()
        : Number.POSITIVE_INFINITY;
      const bDate = isCompleteIsoDate(b?.startDate)
        ? new Date(`${b.startDate}T00:00:00`).getTime()
        : Number.POSITIVE_INFINITY;
      if (aDate !== bDate) return aDate - bDate;
      return String(a?.installer || '').localeCompare(String(b?.installer || ''));
    });
  const defaultScheduleDateStr = () => {
    const date = selectedDate || (job?.schedule?.startDate ? new Date(job.schedule.startDate) : new Date());
    return format(date, 'yyyy-MM-dd');
  };
  const updateEntryAt = (idx, patch) => {
    setFormData((prev) => ({
      ...prev,
      entries: (prev.entries || []).map((entry, i) => (i === idx ? { ...entry, ...patch } : entry)),
    }));
  };
  const dateFieldSnapshotRef = useRef(null);
  const handleDateFocus = (idx, field) => {
    const entry = formData.entries?.[idx];
    dateFieldSnapshotRef.current = { idx, field, value: entry?.[field] || '' };
  };
  const handleDateBlur = (idx, field) => {
    setFormData((prev) => {
      const entries = [...(prev.entries || [])];
      const entry = entries[idx];
      if (!entry) return prev;

      const value = entry[field] || '';
      const snapshot = dateFieldSnapshotRef.current;

      if (isBeforeCurrentYear(value)) {
        if (!window.confirm(PAST_YEAR_CONFIRM_MESSAGE)) {
          const revertValue =
            snapshot?.idx === idx && snapshot?.field === field ? snapshot.value : '';
          entries[idx] = { ...entry, [field]: revertValue };
          return { ...prev, entries };
        }
      }

      if (field === 'startDate' && isCompleteIsoDate(entry.startDate) && !isCompleteIsoDate(entry.endDate)) {
        entries[idx] = { ...entry, endDate: entry.startDate };
      }

      return { ...prev, entries: sortScheduleEntries(entries) };
    });
  };

  const [formData, setFormData] = useState({
    title: '',
    startTime: '09:00',
    endTime: '17:00',
    allDay: true,
    excludeSaturdays: false,
    excludeSundays: false,
    description: '',
    jobId: null,
    color: '#1976D2', // Default blue
    // Each entry is an independent "group":
    // { installer, start date, end date }
    entries: [{ _localId: newEntryLocalId(), installer: '', startDate: '', endDate: '' }],
  });
  const [availableJobs, setAvailableJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareSmsRecipient, setShareSmsRecipient] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [sendingShare, setSendingShare] = useState(false);
  const resolvedJob =
    (formData.jobId ? availableJobs.find((j) => String(j._id) === String(formData.jobId)) : null) ||
    job ||
    null;
  const headerAddressLine =
    resolvedJob?.jobAddress && (resolvedJob.jobAddress.street || resolvedJob.jobAddress.city || resolvedJob.jobAddress.state || resolvedJob.jobAddress.zip)
      ? [resolvedJob.jobAddress.street, resolvedJob.jobAddress.city, resolvedJob.jobAddress.state, resolvedJob.jobAddress.zip]
          .filter(Boolean)
          .join(', ')
      : resolvedJob?.customerId?.address && (resolvedJob.customerId.address.street || resolvedJob.customerId.address.city || resolvedJob.customerId.address.state || resolvedJob.customerId.address.zip)
        ? [resolvedJob.customerId.address.street, resolvedJob.customerId.address.city, resolvedJob.customerId.address.state, resolvedJob.customerId.address.zip]
            .filter(Boolean)
            .join(', ')
        : '';
  const headerPhoneRaw =
    resolvedJob?.jobContact?.phone?.trim()
      ? resolvedJob.jobContact.phone.trim()
      : resolvedJob?.customerId?.primaryPhone?.trim()
        ? resolvedJob.customerId.primaryPhone.trim()
        : '';
  const headerPhoneLine = headerPhoneRaw ? formatPhoneForDisplay(headerPhoneRaw) : '';
  const headerGateCode = String(resolvedJob?.customerId?.gateCode || '').trim();

  const formatAddress = (address) => {
    if (!address) return '';
    return [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
  };

  const buildCustomerShareMessageText = () => {
    const customer = resolvedJob?.customerId || {};
    const address = resolvedJob?.jobAddress
      ? formatAddress(resolvedJob.jobAddress)
      : formatAddress(customer.address);
    return buildCustomerShareMessage({
      customer,
      jobTitle: resolvedJob?.title,
      address,
      extraPhones: resolvedJob?.jobContact?.phone ? [resolvedJob.jobContact.phone] : [],
      extraEmail: resolvedJob?.jobContact?.email || customer?.primaryEmail,
    });
  };

  const handleOpenShareDialog = () => {
    setShareSmsRecipient('');
    setShareMessage(buildCustomerShareMessageText());
    setShareDialogOpen(true);
  };

  const handleCloseShareDialog = () => {
    setShareDialogOpen(false);
    setShareSmsRecipient('');
    setShareMessage('');
    setSendingShare(false);
  };

  const handleSendShareSms = async () => {
    if (!shareSmsRecipient) {
      toast.error('Enter a phone number or select a recipient');
      return;
    }
    if (!shareMessage.trim()) {
      toast.error('Message cannot be empty');
      return;
    }
    try {
      setSendingShare(true);
      await axios.post(`${API_URL}/twilio/send-sms`, {
        ...parseSmsRecipientSelection(shareSmsRecipient),
        message: shareMessage.trim(),
        customerId: resolvedJob?.customerId?._id || resolvedJob?.customerId || undefined,
      });
      toast.success('Customer info sent by text');
      handleCloseShareDialog();
    } catch (error) {
      console.error('Error sending customer info text:', error);
      toast.error(error.response?.data?.error || 'Failed to send text');
    } finally {
      setSendingShare(false);
    }
  };

  useEffect(() => {
    if (!shareDialogOpen) return;
    setShareMessage(buildCustomerShareMessageText());
  }, [shareDialogOpen, resolvedJob]);

  useEffect(() => {
    if (open) {
      // Set default dates from selected date or job
      const date = selectedDate || (job?.schedule?.startDate ? new Date(job.schedule.startDate) : new Date());
      const dateStr = format(date, 'yyyy-MM-dd');
      const legacyEndDateStr = job?.schedule?.endDate
        ? format(new Date(job.schedule.endDate), 'yyyy-MM-dd')
        : dateStr;

      const scheduleEntries = Array.isArray(job?.schedule?.entries) ? job.schedule.entries : [];
      let computedEntries = [];

      if (scheduleEntries.length > 0) {
        computedEntries = scheduleEntries.map((entry) => ({
          installer: entry?.installer || '',
          startDate: entry?.startDate ? format(new Date(entry.startDate), 'yyyy-MM-dd') : '',
          endDate: entry?.endDate ? format(new Date(entry.endDate), 'yyyy-MM-dd') : '',
        }));
      } else {
        // Backward compatibility: build grouped entries from legacy fields.
        const installersList = Array.isArray(job?.schedule?.installers) && job.schedule.installers.length > 0
          ? job.schedule.installers.filter(Boolean)
          : (job?.schedule?.installer ? [job.schedule.installer] : []);

        const installers = installersList.length > 0
          ? installersList
          : selectedInstaller
            ? [selectedInstaller]
            : [''];

        computedEntries = installers.map((inst) => ({
          installer: inst,
          startDate: dateStr,
          endDate: legacyEndDateStr,
        }));
      }

      if (selectedInstaller && computedEntries.length > 0 && !computedEntries[0].installer) {
        computedEntries[0].installer = selectedInstaller;
      }
      
      setFormData({
        title: job?.schedule?.title || job?.title || '',
        startTime: '09:00',
        endTime: '17:00',
        allDay: true,
        excludeSaturdays: false,
        excludeSundays: false,
        description: job?.customerId?.name ? `Customer: ${job.customerId.name}` : '',
        jobId: job?._id || null,
        color: job?.color || '#1976D2',
        entries: sortScheduleEntries(withEntryLocalIds(computedEntries)),
      });

      // Fetch available jobs
      fetchAvailableJobs();
    }
  }, [open, selectedDate, job, selectedInstaller]);

  const fetchAvailableJobs = async () => {
    try {
      const response = await axios.get(`${API_URL}/jobs`);
      const jobs = response.data.jobs || response.data || [];
      setAvailableJobs(jobs.filter((j) => !shouldExcludeJobFromCalendarSchedule(j)));
    } catch (error) {
      console.error('Error fetching jobs:', error);
    }
  };

  // Fuzzy match: every character of `query` appears in order in `str` (case-insensitive)
  const fuzzyMatch = (query, str) => {
    if (!query || !str) return true;
    const q = query.toLowerCase().trim();
    const s = String(str).toLowerCase();
    let i = 0;
    for (let j = 0; j < s.length && i < q.length; j++) {
      if (s[j] === q[i]) i++;
    }
    return i === q.length;
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast.error('Please enter a title');
      return;
    }

    if (entriesHavePastYearDates(formData.entries)) {
      if (!window.confirm(PAST_YEAR_CONFIRM_MESSAGE)) {
        return;
      }
    }

    try {
      setLoading(true);

      // If jobId is selected, update the job's schedule
      if (formData.jobId) {
        const normalizedEntries = sortScheduleEntries(formData.entries || [])
          .map((entry) => {
            const installer = String(entry?.installer || '').trim();
            const startDate = entry?.startDate || '';
            const endDate = entry?.endDate || entry?.startDate || '';
            return { installer, startDate, endDate };
          })
          .filter((entry) => entry.installer && entry.startDate);

        if (normalizedEntries.length === 0) {
          toast.error('Please add at least one installer group (installer + start date)');
          setLoading(false);
          return;
        }

        const shouldExcludeSaturdays = !!formData.excludeSaturdays;
        const shouldExcludeSundays = !!formData.excludeSundays;

        // Expand each entry range into allowed days, then re-group into smaller consecutive ranges.
        const expandedEntries = [];
        for (const entry of normalizedEntries) {
          const installer = entry.installer;
          const start = new Date(entry.startDate + 'T00:00:00');
          const end = new Date(entry.endDate + 'T00:00:00');

          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

          // Ensure start <= end
          const rangeStart = start.getTime() <= end.getTime() ? start : end;
          const rangeEnd = start.getTime() <= end.getTime() ? end : start;

          let groupStart = null; // Date
          let prevAllowed = null; // Date

          for (let d = rangeStart; d.getTime() <= rangeEnd.getTime(); d = addDays(d, 1)) {
            const day = d.getDay(); // 0=Sun, 6=Sat
            const isBlocked =
              (shouldExcludeSaturdays && day === 6) ||
              (shouldExcludeSundays && day === 0);

            if (isBlocked) {
              if (groupStart && prevAllowed) {
                expandedEntries.push({
                  installer,
                  startDate: format(groupStart, 'yyyy-MM-dd'),
                  endDate: format(prevAllowed, 'yyyy-MM-dd'),
                });
              }
              groupStart = null;
              prevAllowed = null;
              continue;
            }

            if (!groupStart) {
              groupStart = d;
              prevAllowed = d;
              continue;
            }

            const expectedNext = addDays(prevAllowed, 1);
            if (expectedNext.getTime() === d.getTime()) {
              prevAllowed = d;
            } else {
              expandedEntries.push({
                installer,
                startDate: format(groupStart, 'yyyy-MM-dd'),
                endDate: format(prevAllowed, 'yyyy-MM-dd'),
              });
              groupStart = d;
              prevAllowed = d;
            }
          }

          if (groupStart && prevAllowed) {
            expandedEntries.push({
              installer,
              startDate: format(groupStart, 'yyyy-MM-dd'),
              endDate: format(prevAllowed, 'yyyy-MM-dd'),
            });
          }
        }

        if (expandedEntries.length === 0) {
          toast.error('No valid days left after excluding weekends');
          setLoading(false);
          return;
        }

        const updatedEntries = expandedEntries.map((entry) => {
          const startDateTime = formData.allDay
            ? new Date(entry.startDate + 'T00:00:00')
            : new Date(entry.startDate + 'T' + formData.startTime);
          const endDateTime = formData.allDay
            ? new Date(entry.endDate + 'T23:59:59')
            : new Date(entry.endDate + 'T' + formData.endTime);

          return {
            installer: entry.installer,
            startDate: startDateTime.toISOString(),
            endDate: endDateTime.toISOString(),
          };
        });

        const legacyInstallers = Array.from(new Set(updatedEntries.map((e) => e.installer).filter(Boolean)));
        const earliest = updatedEntries.reduce((acc, e) =>
          new Date(e.startDate).getTime() <= new Date(acc.startDate).getTime() ? e : acc
        );
        const latest = updatedEntries.reduce((acc, e) =>
          new Date(e.endDate).getTime() >= new Date(acc.endDate).getTime() ? e : acc
        );

        await axios.patch(`${API_URL}/jobs/${formData.jobId}`, {
          schedule: {
            // Legacy single date range (Google sync + older clients)
            startDate: earliest.startDate,
            endDate: latest.endDate,
            installer: earliest.installer,
            installers: legacyInstallers,

            // Preferred multi-schedule model
            entries: updatedEntries,
            recurrence: {
              type: 'none',
              interval: 1,
              count: 1,
            },
            crewNotes: job?.schedule?.crewNotes,
            title: formData.title,
            returnToBench: Boolean(job?.schedule?.returnToBench),
          },
          // Keep the existing job stage; do not auto-advance it when scheduling
          color: formData.color,
        });

        // Job (including display color) is already saved. Google sync is optional.
        try {
          await axios.post(`${API_URL}/calendar/jobs/${formData.jobId}/sync`);
          toast.success('Job saved and synced to Google Calendar.');
        } catch (calendarError: unknown) {
          if (!isAxiosError(calendarError)) {
            toast.success('Job saved. Google Calendar sync could not be reached.');
          } else {
            const status = calendarError.response?.status;
            const data = calendarError.response?.data as
              | { code?: string; error?: string; message?: string }
              | undefined;
            const apiCode = data?.code;
            const msg = String(data?.error || data?.message || calendarError.message || '');
            const notConfigured =
              apiCode === 'GOOGLE_NOT_CONFIGURED' ||
              (status === 503 &&
                (msg.includes('not configured') || msg.includes('Please configure Google Calendar')));
            if (notConfigured) {
              toast.success(
                'Job saved in Paarth (schedule and color). Google Calendar is not set up on the server, so nothing was sent to Google.',
                { duration: 7000 },
              );
            } else if (status === 503 || msg.toLowerCase().includes('sync failed')) {
              toast.success(
                'Job saved in Paarth (schedule and color). Google Calendar sync failed — your changes are still stored here.',
                { duration: 6000 },
              );
            } else {
              toast.success(
                'Job saved in Paarth. Google Calendar sync failed — your changes are still stored here.',
                { duration: 6000 },
              );
            }
          }
        }
      } // end if (formData.jobId)

      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving event:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to save event';
      console.error('Error details:', {
        message: errorMessage,
        status: error.response?.status,
        data: error.response?.data
      });
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };


  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="sm" 
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          m: { xs: 1, sm: 2 },
          maxHeight: { xs: '95vh', sm: '90vh' },
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 120 }}>
          <span>{job ? 'Edit Event' : 'Schedule Job'}</span>
        </Box>
        <Box sx={{ flex: 1, textAlign: 'center', px: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
          <Box sx={{ minWidth: 0 }}>
          {headerAddressLine ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                maxWidth: { xs: '48vw', sm: '55vw', md: '34vw' },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'middle',
                mx: 'auto',
              }}
              title={headerAddressLine}
            >
              {headerAddressLine}
            </Typography>
          ) : null}
          {headerPhoneLine ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                maxWidth: { xs: '48vw', sm: '55vw', md: '34vw' },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                mx: 'auto',
                mt: 0.25,
              }}
              title={headerPhoneLine}
            >
              {headerPhoneLine}
            </Typography>
          ) : null}
          {headerGateCode ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                maxWidth: { xs: '48vw', sm: '55vw', md: '34vw' },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                mx: 'auto',
                mt: 0.25,
              }}
              title={`Gate code: ${headerGateCode}`}
            >
              Gate code: {headerGateCode}
            </Typography>
          ) : null}
          </Box>
          {(headerAddressLine || headerPhoneLine || headerGateCode) && (
            <Tooltip title="Text customer info">
              <IconButton size="small" onClick={handleOpenShareDialog}>
                <ShareIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        {(job || formData.jobId) && onViewJob && (
          <Button
            size="small"
            startIcon={<PersonIcon />}
            onClick={() => {
              const id = formData.jobId || job?._id;
              if (id) {
                onViewJob(id);
                onClose();
              }
            }}
          >
            View job
          </Button>
        )}
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            fullWidth
            required
          />

          <Autocomplete
            options={availableJobs}
            value={availableJobs.find(j => j._id === formData.jobId) || null}
            onChange={(_, newValue) => {
              const selectedJob = newValue;
              setFormData({
                ...formData,
                jobId: selectedJob?._id || null,
                title: selectedJob?.schedule?.title || selectedJob?.title || formData.title,
                color: selectedJob?.color || formData.color,
              });
            }}
            getOptionLabel={(j) => (j && j.title) ? `${j.title} - ${j.customerId?.name || 'Unknown'}` : ''}
            filterOptions={(options, { inputValue }) => {
              const q = inputValue.trim();
              if (!q) return options;
              return options.filter(j => fuzzyMatch(q, `${j.title} ${j.customerId?.name || ''}`));
            }}
            renderInput={(params) => (
              <TextField {...params} label="Job (Optional)" placeholder="Type to search jobs..." />
            )}
            isOptionEqualToValue={(option, value) => option?._id === value?._id}
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Schedule Groups
              </Typography>
              <IconButton
                size="small"
                onClick={() => {
                  const dateStr = defaultScheduleDateStr();
                  setFormData((prev) => ({
                    ...prev,
                    entries: [
                      ...(Array.isArray(prev.entries) ? prev.entries : []),
                      {
                        _localId: newEntryLocalId(),
                        installer: '',
                        startDate: dateStr,
                        endDate: dateStr,
                      },
                    ],
                  }));
                }}
                title="Add another installer/date group"
                sx={{
                  border: `1px solid ${theme.palette.divider}`,
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)',
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Box>

            {(formData.entries || []).map((entry, idx) => (
              <Box
                key={entry._localId || idx}
                sx={{
                  border: `1px solid ${theme.palette.divider}`,
                  borderLeft: `6px solid ${getGroupAccent(idx)}`,
                  borderRadius: 1.5,
                  p: 1.25,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(255,255,255,0.03)'
                      : 'rgba(25, 118, 210, 0.05)',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: theme.palette.text.primary }}
                  >
                    Group {idx + 1}
                  </Typography>
                  {(formData.entries || []).length > 1 && (
                    <IconButton
                      size="small"
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          entries: prev.entries.filter((_, i) => i !== idx),
                        }));
                      }}
                      title="Remove this group"
                      sx={{
                        border: `1px solid ${theme.palette.divider}`,
                        backgroundColor:
                          theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)',
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>

                <Autocomplete
                  freeSolo
                  options={installerOptions}
                  value={entry.installer || ''}
                  onChange={(_, newValue) => {
                    const next = typeof newValue === 'string' ? newValue : (newValue || '').toString();
                    updateEntryAt(idx, { installer: next });
                  }}
                  inputValue={entry.installer || ''}
                  onInputChange={(_, newInputValue) => {
                    updateEntryAt(idx, { installer: newInputValue || '' });
                  }}
                  renderInput={(params) => (
                    <TextField {...params} label="Installer" fullWidth />
                  )}
                />

                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <TextField
                    label="Start Date"
                    type="date"
                    value={entry.startDate || ''}
                    onChange={(e) => updateEntryAt(idx, { startDate: e.target.value })}
                    onFocus={() => handleDateFocus(idx, 'startDate')}
                    onBlur={() => handleDateBlur(idx, 'startDate')}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: '2000-01-01', max: '2099-12-31' }}
                    sx={{ flex: 1, minWidth: 160 }}
                  />

                  <TextField
                    label="End Date"
                    type="date"
                    value={entry.endDate || ''}
                    onChange={(e) => updateEntryAt(idx, { endDate: e.target.value })}
                    onFocus={() => handleDateFocus(idx, 'endDate')}
                    onBlur={() => handleDateBlur(idx, 'endDate')}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: '2000-01-01', max: '2099-12-31' }}
                    sx={{ flex: 1, minWidth: 160 }}
                  />
                </Box>
              </Box>
            ))}
          </Box>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.5,
                borderRadius: 1,
                border: `1px solid ${theme.palette.divider}`,
                backgroundColor: formData.excludeSaturdays
                  ? theme.palette.mode === 'dark'
                    ? 'rgba(76, 175, 80, 0.18)'
                    : 'rgba(76, 175, 80, 0.10)'
                  : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={formData.excludeSaturdays}
                onChange={(e) => setFormData({ ...formData, excludeSaturdays: e.target.checked })}
                id="excludeSaturdays"
              />
              <label htmlFor="excludeSaturdays">Exclude Saturdays</label>
            </Box>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.5,
                borderRadius: 1,
                border: `1px solid ${theme.palette.divider}`,
                backgroundColor: formData.excludeSundays
                  ? theme.palette.mode === 'dark'
                    ? 'rgba(255, 152, 0, 0.16)'
                    : 'rgba(255, 152, 0, 0.10)'
                  : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={formData.excludeSundays}
                onChange={(e) => setFormData({ ...formData, excludeSundays: e.target.checked })}
                id="excludeSundays"
              />
              <label htmlFor="excludeSundays">Exclude Sundays</label>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <input
              type="checkbox"
              checked={formData.allDay}
              onChange={(e) => setFormData({ ...formData, allDay: e.target.checked })}
              id="allDay"
            />
            <label htmlFor="allDay">All day</label>
          </Box>

          {!formData.allDay && (
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Start Time"
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="End Time"
                type="time"
                value={formData.endTime}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Box>
          )}

          <TextField
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            fullWidth
            multiline
            rows={3}
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" sx={{ minWidth: 100 }}>
              Color:
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
              <Box
                component="input"
                type="color"
                aria-label="Pick event color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                sx={{
                  width: 44,
                  height: 44,
                  p: 0,
                  border: 'none',
                  borderRadius: 1,
                  background: 'none',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  '&::-webkit-color-swatch-wrapper': {
                    p: 0,
                  },
                  '&::-webkit-color-swatch': {
                    border: '1px solid rgba(0,0,0,0.25)',
                    borderRadius: '6px',
                  },
                  '&::-moz-color-swatch': {
                    border: '1px solid rgba(0,0,0,0.25)',
                    borderRadius: '6px',
                  },
                }}
              />
              <Typography variant="caption" color="text.secondary">
                Full palette picker
              </Typography>
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        {(job?.schedule?.entries?.length > 0 || job?.schedule?.startDate) && (
          <Button 
            onClick={async () => {
              if (!window.confirm(`Are you sure you want to remove "${job.title}" from the calendar?`)) {
                return;
              }
              try {
                setLoading(true);
                await axios.patch(`${API_URL}/jobs/${job._id}`, {
                  schedule: {
                    startDate: null,
                    endDate: null,
                    installer: '',
                    installers: [],
                    entries: [],
                    returnToBench: false,
                  },
                  stage: 'READY_TO_SCHEDULE',
                  color: DEFAULT_BENCH_JOB_COLOR,
                });

                // Remove from Google Calendar if synced
                try {
                  await axios.delete(`${API_URL}/calendar/jobs/${job._id}/sync`);
                } catch (calendarError) {
                  console.warn('Google Calendar removal failed:', calendarError);
                }

                toast.success('Job removed from calendar');
                onSave();
                onClose();
              } catch (error) {
                console.error('Error removing job from calendar:', error);
                toast.error('Failed to remove job from calendar');
              } finally {
                setLoading(false);
              }
            }}
            color="error"
            disabled={loading}
            startIcon={<DeleteIcon />}
          >
            Remove from Calendar
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? <CircularProgress size={20} /> : 'Save'}
        </Button>
      </DialogActions>

      <Dialog open={shareDialogOpen} onClose={handleCloseShareDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Share Customer by Text</DialogTitle>
        <DialogContent>
          <EmployeeSmsRecipientField
            dialogOpen={shareDialogOpen}
            value={shareSmsRecipient}
            onChange={setShareSmsRecipient}
            disabled={sendingShare}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            fullWidth
            multiline
            minRows={4}
            label="Message"
            value={shareMessage}
            onChange={(e) => setShareMessage(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseShareDialog} disabled={sendingShare}>Cancel</Button>
          <Button onClick={handleSendShareSms} variant="contained" disabled={sendingShare}>
            {sendingShare ? 'Sending...' : 'Send Text'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

/** Scheduled events whose date range covers `date`. */
function eventsOnDate(events, date) {
  const dateStr = format(date, 'yyyy-MM-dd');
  return (events || []).filter((e) => {
    if (!e.schedule?.startDate) return false;
    const startStr = format(new Date(e.schedule.startDate), 'yyyy-MM-dd');
    const endStr = format(new Date(e.schedule.endDate || e.schedule.startDate), 'yyyy-MM-dd');
    return dateStr >= startStr && dateStr <= endStr;
  });
}

/** Flattens a calendar chip into the read-only facts a phone user needs. */
function scheduledEventSummary(event) {
  const job = event?.job || {};
  const customer = job.customerId || {};
  const jobAddress = job.jobAddress || {};
  const hasJobAddress = jobAddress.street || jobAddress.city || jobAddress.state || jobAddress.zip;
  const address = hasJobAddress ? jobAddress : customer.address;
  const start = event?.schedule?.startDate ? new Date(event.schedule.startDate) : null;
  const end = event?.schedule?.endDate ? new Date(event.schedule.endDate) : start;
  const multiDay =
    start && end && format(start, 'yyyy-MM-dd') !== format(end, 'yyyy-MM-dd');

  return {
    key: event?._id,
    customerName: customer.name || job.title || 'Unknown customer',
    jobTitle: job.title || '',
    location: [address?.street, address?.city, address?.state, address?.zip].filter(Boolean).join(', '),
    installer: event?.schedule?.installer || '',
    phone: String(job.jobContact?.phone || customer.primaryPhone || '').trim(),
    dateLabel: !start
      ? ''
      : multiDay
        ? `${format(start, 'EEE MMM d')} \u2013 ${format(end, 'EEE MMM d')}`
        : format(start, 'EEE MMM d, yyyy'),
    shortDateLabel: !start
      ? ''
      : multiDay
        ? `${format(start, 'MMM d')} \u2013 ${format(end, 'MMM d')}`
        : format(start, 'EEE MMM d'),
    startDate: start,
    color: event?.color || DEFAULT_BENCH_JOB_COLOR,
    closedOut: isHistoricalClosedJob(job),
  };
}

function ScheduleDetailRow({ label, value }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 68, flexShrink: 0, pt: 0.15 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}

function ScheduleSummaryCard({ summary }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderLeft: `4px solid ${summary.color}`, opacity: summary.closedOut ? 0.75 : 1 }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
        {summary.customerName}
      </Typography>
      {summary.jobTitle && summary.jobTitle !== summary.customerName && (
        <Typography variant="body2" color="text.secondary">
          {summary.jobTitle}
        </Typography>
      )}
      <ScheduleDetailRow label="Installer" value={summary.installer || 'Unassigned'} />
      <ScheduleDetailRow label="Location" value={summary.location || 'No address on file'} />
      <ScheduleDetailRow label="Scheduled" value={summary.dateLabel || 'No dates'} />
      {summary.phone && (
        <Button
          size="small"
          variant="outlined"
          href={`tel:${nanpDigitsOnly(summary.phone) || summary.phone}`}
          sx={{ mt: 1.25 }}
        >
          Call {formatPhoneForDisplay(summary.phone)}
        </Button>
      )}
    </Paper>
  );
}

/**
 * Phone-only, read-only schedule for the week around the tapped day.
 * `hiddenWeekdays` mirrors the weekdays the user hid on the calendar grid.
 */
function MobileWeekScheduleDialog({ open, date, events, hiddenWeekdays = [], onClose }) {
  const theme = useTheme();
  const weekStart = date ? startOfWeek(date) : null;

  const days = useMemo(() => {
    if (!weekStart) return [];
    return [0, 1, 2, 3, 4, 5, 6]
      .map((offset) => addDays(weekStart, offset))
      .filter((day) => !hiddenWeekdays.includes(day.getDay()))
      .map((day) => ({
        day,
        summaries: eventsOnDate(events, day).map(scheduledEventSummary),
      }));
  }, [weekStart, events, hiddenWeekdays]);

  const totalJobs = days.reduce((sum, entry) => sum + entry.summaries.length, 0);
  const weekEnd = days.length > 0 ? days[days.length - 1].day : null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, pb: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {weekStart && weekEnd ? `${format(weekStart, 'MMM d')} \u2013 ${format(weekEnd, 'MMM d')}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {totalJobs === 1 ? '1 job this week' : `${totalJobs} jobs this week`}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close week schedule">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 2, pb: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {days.map(({ day, summaries }) => {
            const isTappedDay = date ? isSameDay(day, date) : false;
            return (
              <Box key={format(day, 'yyyy-MM-dd')}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                    mb: 0.75,
                    pb: 0.25,
                    borderBottom: `2px solid ${isTappedDay ? theme.palette.primary.main : theme.palette.divider}`,
                    color: isTappedDay ? 'primary.main' : 'text.primary',
                  }}
                >
                  {format(day, 'EEEE, MMM d')}
                  {isToday(day) ? ' \u00b7 Today' : ''}
                </Typography>
                {summaries.length === 0 ? (
                  <Typography variant="body2" color="text.disabled">
                    Nothing scheduled
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                    {summaries.map((summary) => (
                      <ScheduleSummaryCard key={summary.key} summary={summary} />
                    ))}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

// Calendar Day Component
function CalendarDay({ date, isCurrentMonth, events, onDayClick, onEventClick, onEventDelete, onViewJob, onDayContextMenu, installerOrder, holidayLabel = '', tvMode = false, viewOnly = false }) {
  const theme = useTheme();
  const [contextMenu, setContextMenu] = useState(null);
  const [contextMenuEvent, setContextMenuEvent] = useState(null);
  const eventsForDate = eventsOnDate(events, date);
  // Keep rows visually aligned across days by installer “lane”
  // We support up to 5 horizontal “sections” per day:
  // 4 dedicated installer lanes + 1 “Other” lane.
  const primaryInstallers = installerOrder.slice(0, 4);
  const laneInstallers = [...primaryInstallers, '__OTHER__']; // 5th lane for everything else

  // 1. For each lane, pick at most one event for that lane.
  const laneEvents = laneInstallers.map((installerKey) => {
    if (installerKey === '__OTHER__') {
      // First event whose installer is NOT one of the primary installers
      const match = eventsForDate.find((e) => {
        const name = e.schedule?.installer || '';
        return !primaryInstallers.includes(name);
      });
      return match || null;
    }
    const match = eventsForDate.find(
      (e) => (e.schedule?.installer || '') === installerKey
    );
    return match || null;
  });

  // 2. Count any remaining “other” events for a small "+N more" indicator in the bottom lane.
  const extraOtherEventsCount = eventsForDate.filter((e) => {
    const name = e.schedule?.installer || '';
    const isPrimary = primaryInstallers.includes(name);
    const isInOtherLane =
      !isPrimary &&
      laneEvents[laneEvents.length - 1] &&
      laneEvents[laneEvents.length - 1]._id === e._id;
    return !isPrimary && !isInOtherLane;
  }).length;

  const handleContextMenu = (e, event) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu(
      contextMenu === null
        ? {
            mouseX: e.clientX + 2,
            mouseY: e.clientY - 6,
          }
        : null
    );
    setContextMenuEvent(event);
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
    setContextMenuEvent(null);
  };

  const handleDelete = () => {
    if (contextMenuEvent && onEventDelete) {
      onEventDelete(contextMenuEvent);
    }
    handleCloseContextMenu();
  };

  return (
    <>
      <Paper
        sx={{
          width: '100%',
          height: '100%',
          p: 0.5,
          border: `1px solid ${theme.palette.divider}`,
          backgroundColor: isCurrentMonth 
            ? theme.palette.background.paper 
            : (theme.palette.mode === 'dark' ? '#141414' : '#f7f7f7'),
          // Adjacent-month padding days: keep grid alignment but make jobs nearly invisible
          opacity: isCurrentMonth ? 1 : 0.14,
          cursor: 'pointer',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          transition: 'background-color 0.15s ease, opacity 0.15s ease',
          '&:hover': {
            backgroundColor: isCurrentMonth 
              ? (theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5')
              : (theme.palette.mode === 'dark' ? '#1E1E1E' : '#f0f0f0'),
            opacity: isCurrentMonth ? 1 : 0.38,
          },
        }}
        onClick={() => onDayClick(date)}
        onContextMenu={(e) => {
          if (onDayContextMenu) {
            e.preventDefault();
            e.stopPropagation();
            onDayContextMenu(date, e);
          }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: isToday(date) ? 800 : 600,
              color: isToday(date)
                ? 'primary.main'
                : isCurrentMonth
                  ? 'text.primary'
                  : theme.palette.mode === 'dark'
                    ? 'rgba(255,255,255,0.22)'
                    : 'rgba(0,0,0,0.22)',
              flexShrink: 0,
              lineHeight: 1.2,
              fontSize: { xs: '0.8rem', sm: '0.9rem' },
            }}
          >
            {format(date, 'd')}
          </Typography>
          {holidayLabel && (
            <Typography
              variant="caption"
              title={holidayLabel}
              sx={{
                color: theme.palette.mode === 'dark' ? '#FFD166' : '#8A5A00',
                backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 209, 102, 0.14)' : 'rgba(255, 209, 102, 0.22)',
                border: theme.palette.mode === 'dark' ? '1px solid rgba(255, 209, 102, 0.35)' : '1px solid rgba(138, 90, 0, 0.25)',
                borderRadius: '10px',
                px: 0.5,
                py: 0.15,
                fontSize: tvMode ? '0.56rem' : '0.62rem',
                fontWeight: 800,
                letterSpacing: '0.01em',
                lineHeight: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'clip',
                maxWidth: tvMode ? '92px' : '140px',
              }}
            >
              {getHolidayChipLabel(holidayLabel, tvMode)}
            </Typography>
          )}
        </Box>
        
        {/* Phones show colour bars instead of chips — text is unreadable in a ~50px cell. */}
        {viewOnly ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, mt: 0.4, width: '100%' }}>
            {eventsForDate.slice(0, 3).map((event) => (
              <Box
                key={event._id}
                sx={{
                  height: 5,
                  borderRadius: '2px',
                  width: '100%',
                  backgroundColor: event.color || DEFAULT_BENCH_JOB_COLOR,
                  opacity: isHistoricalClosedJob(event.job) ? 0.5 : 1,
                }}
              />
            ))}
            {eventsForDate.length > 3 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: '0.55rem', lineHeight: 1, textAlign: 'right' }}
              >
                +{eventsForDate.length - 3}
              </Typography>
            )}
          </Box>
        ) : (
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          flex: 1,
          width: '100%',
          overflow: 'hidden',
          minHeight: 0,
          gap: 0,
          justifyContent: 'flex-start',
        }}>
          {laneEvents.map((event, index) => (
            <Box
              key={event?._id || `lane-${index}`}
              sx={{
                flex: '1 1 0',
                width: '100%',
                minHeight: 0,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                overflow: 'hidden',
                gap: 0.25,
              }}
            >
              {event && (() => {
                const historical = isHistoricalClosedJob(event.job);
                return (
                <Chip
                  label={[event.schedule?.title || event.title, event.schedule?.installer].filter(Boolean).join(' | ')}
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(event);
                  }}
                  onContextMenu={(e) => handleContextMenu(e, event)}
                  sx={{
                    width: '100%',
                    maxWidth: '100%',
                    fontSize: { xs: '0.8rem', sm: '0.85rem' },
                    height: 24,
                    maxHeight: '100%',
                    backgroundColor: event.color || '#1976D2',
                    color: theme.palette.getContrastText(event.color || '#1976D2'),
                    borderRadius: '4px',
                    overflow: 'hidden',
                    opacity: historical ? 0.72 : 1,
                    '&.MuiChip-root': {
                      py: 0,
                      px: 0,
                      display: 'flex',
                      justifyContent: 'flex-start',
                    },
                    '& .MuiChip-label': {
                      width: '100%',
                      px: 0.75,
                      py: 0,
                      lineHeight: 1.25,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: 'left',
                    },
                    '&:hover': { opacity: historical ? 0.85 : 0.8 },
                  }}
                />
                );
              })()}
              {index === laneEvents.length - 1 && extraOtherEventsCount > 0 && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: '0.6rem', textAlign: 'right', px: 0.25, lineHeight: 1 }}
                >
                  +{extraOtherEventsCount} more
                </Typography>
              )}
            </Box>
          ))}
        </Box>
        )}
      </Paper>
      
      {/* Context Menu */}
      {contextMenuEvent && (
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
          {onViewJob && contextMenuEvent?._id && (
            <MenuItem
              onClick={() => {
                // For calendar chips, we pass a pseudo-event with `jobId`
                onViewJob(contextMenuEvent.jobId || contextMenuEvent._id);
                handleCloseContextMenu();
              }}
            >
              <ListItemIcon>
                <PersonIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>View job</ListItemText>
            </MenuItem>
          )}
          <MenuItem onClick={handleDelete} disabled={isHistoricalClosedJob(contextMenuEvent?.job)}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {isHistoricalClosedJob(contextMenuEvent?.job)
                ? 'Closed out (reference only)'
                : 'Remove from Calendar'}
            </ListItemText>
          </MenuItem>
        </Menu>
      )}
    </>
  );
}

// Bench Job Card Component
function BenchJobCard({ job, onJobClick, onViewJob, onRemoveFromBench, draggable = false, onDragStart }) {
  const jobTotal = job.valueEstimated || job.valueTotal || 0;
  const defaultDuration = Math.max(1, Math.floor(jobTotal / 2000));
  const keptOnBench = Boolean(job?.schedule?.returnToBench) && hasCalendarSchedule(job);
  const accent = job.color || DEFAULT_BENCH_JOB_COLOR;

  return (
    <Card
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.stopPropagation();
        onDragStart?.(e, job);
      }}
      sx={{
        cursor: draggable ? 'grab' : 'pointer',
        borderLeft: `4px solid ${accent}`,
        minWidth: 150,
        maxWidth: 180,
        position: 'relative',
        '&:hover': {
          boxShadow: 2,
          transform: 'translateY(-1px)',
          transition: 'all 0.2s',
        },
      }}
      onClick={() => onJobClick(job)}
    >
      <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 800,
                fontSize: '0.85rem',
                mb: 0.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={job.title}
            >
              {job.title}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
            >
              <Box
                component="span"
                sx={{
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {job.customerId?.name || 'Unknown'}
              </Box>
              <Box component="span" sx={{ flexShrink: 0, opacity: 0.8 }}>
                | {defaultDuration} days
              </Box>
            </Typography>
            {keptOnBench ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.68rem' }}>
                Dates kept
              </Typography>
            ) : null}
          </Box>
          {onViewJob && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onViewJob(job._id);
              }}
              title="View job (customer & details)"
              sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
            >
              <PersonIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
          {onRemoveFromBench && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFromBench(job);
              }}
              title="Remove from bench (move to dead estimates)"
              sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

// Scheduled Job Card Component (with green checkmark)
function ScheduledJobCard({ job, onJobClick, onJobDelete, onViewJob, draggable = false, onDragStart }) {
  const jobTotal = job.valueEstimated || job.valueTotal || 0;
  const defaultDuration = Math.max(1, Math.floor(jobTotal / 2000));

  return (
    <Card
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.stopPropagation();
        onDragStart?.(e, job);
      }}
      sx={{
        borderLeft: `4px solid ${job.color || '#4caf50'}`,
        minWidth: 150,
        maxWidth: 180,
        position: 'relative',
        cursor: draggable ? 'grab' : 'pointer',
        '&:hover': {
          boxShadow: 2,
          transform: 'translateY(-1px)',
          transition: 'all 0.2s',
        },
      }}
    >
      <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <CheckCircleIcon sx={{ color: '#4caf50', fontSize: 18 }} />
          <Box 
            sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
            onClick={() => onJobClick(job)}
          >
            <Typography variant="body2" sx={{ fontWeight: 800, fontSize: '0.85rem', mb: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              {defaultDuration} days
            </Typography>
          </Box>
          {onViewJob && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onViewJob(job._id);
              }}
              title="View job (customer & details)"
              sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
            >
              <PersonIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
          {onJobDelete && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onJobDelete(job);
              }}
              title="Remove from schedule"
              sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

/**
 * Bench + “Scheduled” sidebar + job pickers: hide closed/archived/dead jobs.
 * Calendar grid uses `jobEligibleForCalendarGrid` instead so closed jobs stay visible for reference.
 */
/** Closed-out / completed jobs: hide from bench & scheduled sidebar, keep on calendar grid. */
function isHistoricalClosedJob(job) {
  return !!(
    job?.isCompletedClosedOut ||
    job?.stage === 'FINAL_PAYMENT_CLOSED'
  );
}

function shouldExcludeJobFromCalendarSchedule(job) {
  if (!job || job.isArchived || job.isDeadEstimate) return true;
  if (isHistoricalClosedJob(job)) return true;
  return false;
}

function hasCalendarSchedule(job) {
  const entries = job?.schedule?.entries;
  if (Array.isArray(entries) && entries.some((e) => e?.startDate)) return true;
  return !!job?.schedule?.startDate;
}

function isReturnedToBench(job) {
  return Boolean(job?.schedule?.returnToBench);
}

function scheduleFieldsFromJob(job, extra = {}) {
  const schedule = job?.schedule || {};
  return {
    startDate: schedule.startDate || null,
    endDate: schedule.endDate || null,
    installer: schedule.installer || '',
    installers: Array.isArray(schedule.installers) ? schedule.installers : [],
    entries: Array.isArray(schedule.entries) ? schedule.entries : [],
    crewNotes: schedule.crewNotes || '',
    recurrence: schedule.recurrence,
    title: schedule.title,
    returnToBench: Boolean(schedule.returnToBench),
    ...extra,
  };
}

/** Show on calendar month grid (includes closed-out jobs that still have install dates). */
function jobEligibleForCalendarGrid(job) {
  if (!job || job.isArchived || job.isDeadEstimate) return false;
  return hasCalendarSchedule(job) || job.stage === 'SCHEDULED';
}

/** Partition jobs into install bench vs month-grid scheduled (see docs/PAGES.md). */
function splitCalendarJobs(allJobs = []) {
  const readinessStages = ['DEPOSIT_PENDING', 'JOB_PREP', 'TAKEOFF_COMPLETE', 'READY_TO_SCHEDULE'];
  const bench = allJobs.filter((job) => {
    if (!job || job.isArchived || job.isDeadEstimate || isHistoricalClosedJob(job)) return false;
    if (isReturnedToBench(job)) return true;
    return readinessStages.includes(job.stage) && !hasCalendarSchedule(job);
  });
  const scheduled = allJobs.filter((job) => {
    if (shouldExcludeJobFromCalendarSchedule(job)) return false;
    if (isReturnedToBench(job)) return false;
    return hasCalendarSchedule(job) || job.stage === 'SCHEDULED';
  });
  return { bench, scheduled };
}

function CalendarPage({ tvMode = false, externalViewControls = false }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { mode, toggleColorMode } = useAppTheme();
  const { user, canModifyCalendar, canViewCalendar, tenantIdForBranding } = useAuth();
  const { hideSensitive: shopHideSensitive } = useShopViewSensitive(user?.role);
  const financialPin = useFinancialPinLockContext();
  const hideSensitive = shopHideSensitive || financialPin.hideFinancials;
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [currentDate, setCurrentDate] = useState(new Date());
  const [benchJobs, setBenchJobs] = useState([]);
  const [scheduledJobs, setScheduledJobs] = useState([]);
  const [allJobs, setAllJobs] = useState([]);
  const benchJobsRef = useRef([]);
  const scheduledJobsRef = useRef([]);
  const allJobsRef = useRef([]);
  const [selectedInstaller, setSelectedInstaller] = useState('');
  const [loading, setLoading] = useState(true);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobIdForDetailModal, setJobIdForDetailModal] = useState(null);
  const [benchHeight, setBenchHeight] = useState(250);
  const [benchDropActive, setBenchDropActive] = useState(false);
  const [scheduledDropActive, setScheduledDropActive] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isBenchMinimized, setIsBenchMinimized] = useState(false);
  const [installerBaseOrder, setInstallerBaseOrder] = useState(() => {
    try {
      const stored = localStorage.getItem(CALENDAR_INSTALLER_ORDER_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const cleaned = normalizeInstallerOrder(parsed);
        if (cleaned.length > 0) return cleaned;
      }
    } catch (_) {}
    return DEFAULT_INSTALLER_ORDER;
  });
  const [installerOrder, setInstallerOrder] = useState(installerBaseOrder);
  const [installerSettingsOpen, setInstallerSettingsOpen] = useState(false);
  const [installerDraftOrder, setInstallerDraftOrder] = useState(installerBaseOrder);
  const [benchSettingsAnchor, setBenchSettingsAnchor] = useState(null);

  const [benchPosition, setBenchPosition] = useState(() => {
    if (tvMode) return 'right';
    try {
      const stored = localStorage.getItem(CALENDAR_BENCH_POSITION_KEY);
      if (stored === 'top' || stored === 'right' || stored === 'bottom') return stored;
    } catch (_) {}
    return 'right';
  });
  const [benchWidth, setBenchWidth] = useState(tvMode ? 260 : 320);
  // Phones get a read-only month view: no bench, no scheduling, tap a day for that week's schedule.
  const mobileViewOnly = isMobile && !tvMode;
  const [mobileWeekDate, setMobileWeekDate] = useState(null);
  const canModifyCalendarWithPin = () => canModifyCalendar();

  useEffect(() => {
    if (tvMode) return;
    try {
      localStorage.setItem(CALENDAR_BENCH_POSITION_KEY, benchPosition);
    } catch (_) {}
  }, [benchPosition, tvMode]);

  const [hiddenWeekdays, setHiddenWeekdays] = useState(() => {
    try {
      const stored = localStorage.getItem(CALENDAR_HIDDEN_WEEKDAYS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed.filter((d) => d >= 0 && d <= 6) : [];
      }
    } catch (_) {}
    return [];
  });
  const [dayContextMenu, setDayContextMenu] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_HIDDEN_WEEKDAYS_KEY, JSON.stringify(hiddenWeekdays));
    } catch (_) {}
  }, [hiddenWeekdays]);

  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_INSTALLER_ORDER_KEY, JSON.stringify(installerBaseOrder));
    } catch (_) {}
  }, [installerBaseOrder]);

  useEffect(() => {
    fetchJobs();
  }, [currentDate]);

  useEffect(() => {
    benchJobsRef.current = benchJobs;
  }, [benchJobs]);

  useEffect(() => {
    scheduledJobsRef.current = scheduledJobs;
  }, [scheduledJobs]);

  useEffect(() => {
    allJobsRef.current = allJobs;
  }, [allJobs]);

  const fetchJobs = useCallback(async ({ background = false } = {}) => {
    try {
      if (!background) {
        setLoading(true);
      }
      const response = await axios.get(`${API_URL}/jobs`, {
        params: { includeCompletedClosedOut: true, limit: 500 },
      });
      const jobs = response.data.jobs || response.data || [];
      setAllJobs(jobs);
      const { bench, scheduled } = splitCalendarJobs(jobs);

      setBenchJobs(bench);
      setScheduledJobs(scheduled);

      // Update installer order based on any installers used in jobs
      const installerSet = new Set(installerBaseOrder);
      jobs.forEach((job) => {
        const entries = Array.isArray(job?.schedule?.entries) ? job.schedule.entries : [];
        const installers = entries.length > 0
          ? entries.map((e) => e?.installer).filter(Boolean)
          : (Array.isArray(job?.schedule?.installers) && job.schedule.installers.length > 0
            ? job.schedule.installers
            : (job?.schedule?.installer ? [job.schedule.installer] : []));
        installers.forEach((name) => {
          if (name && typeof name === 'string') installerSet.add(name);
        });
      });
      setInstallerOrder(Array.from(installerSet));
    } catch (error) {
      console.error('Error fetching jobs:', error);
      toast.error('Failed to load jobs');
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [installerBaseOrder]);

  const openInstallerSettings = () => {
    setInstallerDraftOrder(installerBaseOrder);
    setInstallerSettingsOpen(true);
  };

  const updateInstallerDraftAt = (index, value) => {
    setInstallerDraftOrder((prev) => prev.map((name, i) => (i === index ? value : name)));
  };

  const moveInstallerDraft = (index, direction) => {
    setInstallerDraftOrder((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[nextIndex];
      copy[nextIndex] = temp;
      return copy;
    });
  };

  const removeInstallerDraft = (index) => {
    setInstallerDraftOrder((prev) => prev.filter((_, i) => i !== index));
  };

  const addInstallerDraft = () => {
    setInstallerDraftOrder((prev) => [...prev, '']);
  };

  const saveInstallerSettings = async () => {
    const cleaned = normalizeInstallerOrder(installerDraftOrder);
    if (cleaned.length === 0) {
      toast.error('Add at least one installer name');
      return;
    }
    setInstallerBaseOrder(cleaned);
    setInstallerSettingsOpen(false);
    toast.success('Installer defaults updated');
    await fetchJobs();
  };

  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const handleRealtimeProjectUpdate = useCallback((payload) => {
    const sourceSocketId = payload?.sourceSocketId || null;
    const ownSocketId = getConnectedSocketId();
    if (sourceSocketId && ownSocketId && sourceSocketId === ownSocketId) return;
    const merged = applyJobRealtimeToList(allJobsRef.current, payload, isActiveCalendarJob);
    const deduped = Array.from(new Map(merged.map((j) => [String(j?._id), j])).values()).filter(Boolean);
    setAllJobs(deduped);
    const { bench, scheduled } = splitCalendarJobs(deduped);
    setBenchJobs(bench);
    setScheduledJobs(scheduled);
  }, []);
  const handleRealtimeTaskUpdate = useCallback((payload) => {
    const sourceSocketId = payload?.sourceSocketId || null;
    const ownSocketId = getConnectedSocketId();
    if (sourceSocketId && ownSocketId && sourceSocketId === ownSocketId) return;
    fetchJobs({ background: true });
  }, [fetchJobs]);

  const handleJobDataChanged = useCallback(() => {
    fetchJobs({ background: true });
  }, [fetchJobs]);

  const handleJobUpdate = useCallback(async (jobId, updates) => {
    try {
      await axios.patch(`${API_URL}/jobs/${jobId}`, updates);
      await fetchJobs({ background: true });
    } catch (error) {
      console.error('Error updating job:', error);
    }
  }, [fetchJobs]);
  useSocketSubscription(tenantRoom, 'project.updated', handleRealtimeProjectUpdate);
  useSocketSubscription(tenantRoom, 'project.created', handleRealtimeProjectUpdate);
  useSocketSubscription(tenantRoom, 'task.updated', handleRealtimeTaskUpdate);
  useSocketSubscription(tenantRoom, 'task.created', handleRealtimeTaskUpdate);

  // Generate calendar days for a specific month
  const getCalendarDaysForMonth = (date) => {
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  };

  // Get months: TV mode shows current + next month.
  // Standard mode stays the same (one on mobile, three on desktop).
  const months = useMemo(() => {
    if (tvMode) {
      return [currentDate, addMonths(currentDate, 1)];
    }
    if (isMobile) {
      return [currentDate];
    }
    return [
      currentDate,
      addMonths(currentDate, 1),
      addMonths(currentDate, 2),
    ];
  }, [currentDate, isMobile, tvMode]);

  const holidayMap = useMemo(() => {
    const years = new Set();
    months.forEach((monthDate) => {
      years.add(monthDate.getFullYear());
      years.add(addMonths(monthDate, -1).getFullYear());
      years.add(addMonths(monthDate, 1).getFullYear());
    });
    const combined = {};
    years.forEach((year) => {
      Object.assign(combined, buildMajorUSHolidayMap(year));
      combined[format(getEasterSunday(year), 'yyyy-MM-dd')] = 'Easter';
    });
    return combined;
  }, [months]);

  // Render one calendar chip per schedule entry (installer + start/end date range).
  // Legacy support: if `schedule.entries` is missing, we fall back to the old single-range + `schedule.installers` model.
  const calendarEvents = useMemo(() => {
    const gridJobs = (allJobs || []).filter(jobEligibleForCalendarGrid);
    return gridJobs.flatMap((job) => {
      const schedule = job?.schedule || {};
      const entries = Array.isArray(schedule?.entries) ? schedule.entries : [];

      if (entries.length > 0) {
        return entries
          .filter((entry) => entry?.startDate && entry?.installer)
          .map((entry, entryIndex) => ({
            _id: `${job._id}_entry_${entryIndex}`,
            eventType: 'entries',
            entryIndex,
            jobId: job._id,
            job,
            title: job?.title,
            color: job?.color,
            schedule: {
              startDate: entry.startDate,
              endDate: entry.endDate || entry.startDate,
              installer: entry.installer,
            },
          }));
      }

      // Legacy fallback
      const installers = Array.isArray(schedule?.installers) && schedule.installers.length > 0
        ? schedule.installers
        : (schedule?.installer ? [schedule.installer] : []);

      if (!schedule?.startDate || installers.length === 0) return [];

      return installers
        .filter(Boolean)
        .map((installer, installerIndex) => ({
          _id: `${job._id}_legacy_${installer}_${installerIndex}`,
          eventType: 'legacy_installer',
          jobId: job._id,
          job,
          title: job?.title,
          color: job?.color,
          schedule: {
            startDate: schedule.startDate,
            endDate: schedule.endDate || schedule.startDate,
            installer,
          },
        }));
    });
  }, [allJobs]);

  const handleDayClick = (date) => {
    if (mobileViewOnly) {
      setMobileWeekDate(date);
      return;
    }
    if (!canModifyCalendarWithPin()) {
      toast.error('You do not have permission to create or modify calendar events');
      return;
    }
    setSelectedDate(date);
    setSelectedJob(null);
    setSelectedInstaller('');
    setEventModalOpen(true);
  };

  const handleEventClick = (eventOrJob) => {
    const job = eventOrJob?.job || eventOrJob;
    if (isHistoricalClosedJob(job)) {
      setJobIdForDetailModal(job._id);
      return;
    }
    if (!canModifyCalendarWithPin()) {
      toast.error('You do not have permission to modify calendar events');
      return;
    }
    setSelectedJob(job);
    setSelectedInstaller(
      eventOrJob?.schedule?.installer ||
        job?.schedule?.installer ||
        (Array.isArray(job?.schedule?.installers) ? job.schedule.installers?.[0] : '') ||
        ''
    );
    const start = eventOrJob?.schedule?.startDate || job?.schedule?.startDate;
    setSelectedDate(start ? new Date(start) : new Date());
    setEventModalOpen(true);
  };

  const handleEventDelete = async (eventOrJob) => {
    const job = eventOrJob?.job || eventOrJob;
    if (isHistoricalClosedJob(job)) {
      toast('This job is closed out — schedule is kept for reference only.');
      return;
    }
    const isCalendarChipEvent = !!eventOrJob?.job && !!eventOrJob?.jobId;
    const eventType = eventOrJob?.eventType;
    const entryIndex = typeof eventOrJob?.entryIndex === 'number' ? eventOrJob.entryIndex : null;
    const installerToRemove = eventOrJob?.schedule?.installer || '';

    if (!canModifyCalendarWithPin()) {
      toast.error('You do not have permission to modify calendar events');
      return;
    }

    const removalLabel =
      isCalendarChipEvent && installerToRemove
        ? `${job.title} (${installerToRemove})`
        : job.title;

    if (!window.confirm(`Are you sure you want to remove "${removalLabel}" from the calendar?`)) {
      return;
    }

    try {
      const clearSchedule = async () => {
        await axios.patch(`${API_URL}/jobs/${job._id}`, {
          schedule: {
            startDate: null,
            endDate: null,
            installer: '',
            installers: [],
            entries: [],
            returnToBench: false,
          },
          stage: 'READY_TO_SCHEDULE',
          color: DEFAULT_BENCH_JOB_COLOR,
        });

        // Remove from Google Calendar if synced
        try {
          await axios.delete(`${API_URL}/calendar/jobs/${job._id}/sync`);
        } catch (calendarError) {
          console.warn('Google Calendar removal failed:', calendarError);
        }

        toast.success('Job removed from calendar');
      };

      // If user clicked the delete button on the Scheduled Job cards,
      // they pass the whole `job`, not a chip/event.
      if (!isCalendarChipEvent) {
        await clearSchedule();
        await fetchJobs();
        return;
      }

      if (eventType === 'entries' && entryIndex !== null) {
        const existingEntries = Array.isArray(job?.schedule?.entries) ? job.schedule.entries : [];
        const remainingEntries = existingEntries.filter((_, i) => i !== entryIndex);

        if (remainingEntries.length === 0) {
          await clearSchedule();
        } else {
          const remainingInstallers = remainingEntries.map((e) => e?.installer).filter(Boolean);
          const earliest = remainingEntries.reduce((acc, e) =>
            new Date(e?.startDate).getTime() <= new Date(acc?.startDate).getTime() ? e : acc
          , remainingEntries[0] || {});
          const latest = remainingEntries.reduce((acc, e) =>
            new Date(e?.endDate).getTime() >= new Date(acc?.endDate).getTime() ? e : acc
          , remainingEntries[0] || {});

          await axios.patch(`${API_URL}/jobs/${job._id}`, {
            schedule: {
              entries: remainingEntries,
              startDate: earliest?.startDate || null,
              endDate: latest?.endDate || earliest?.startDate || null,
              installer: earliest?.installer || '',
              installers: remainingInstallers,
              recurrence: job?.schedule?.recurrence,
              crewNotes: job?.schedule?.crewNotes,
              title: job?.schedule?.title,
              returnToBench: Boolean(job?.schedule?.returnToBench),
            },
          });

          toast.success('Schedule entry removed from calendar');
        }

        await fetchJobs();
        return;
      }

      // Legacy chip removal (old "multiple installers, same date range")
      const existingInstallers = Array.isArray(job?.schedule?.installers) && job.schedule.installers.length > 0
        ? job.schedule.installers
        : (job?.schedule?.installer ? [job.schedule.installer] : []);

      const remainingInstallers = existingInstallers.filter((i) => i !== installerToRemove);

      if (remainingInstallers.length === 0) {
        await clearSchedule();
      } else {
        await axios.patch(`${API_URL}/jobs/${job._id}`, {
          schedule: {
            startDate: job?.schedule?.startDate,
            endDate: job?.schedule?.endDate,
            installer: remainingInstallers[0],
            installers: remainingInstallers,
            recurrence: job?.schedule?.recurrence,
            crewNotes: job?.schedule?.crewNotes,
            title: job?.schedule?.title,
            returnToBench: Boolean(job?.schedule?.returnToBench),
          },
        });

        toast.success('Installer removed from calendar');
      }

      await fetchJobs();
    } catch (error) {
      console.error('Error removing job from calendar:', error);
      toast.error('Failed to remove job from calendar');
    }
  };

  const handleRemoveFromBench = async (job) => {
    if (!window.confirm(`Remove "${job.title}" from the bench? It will be moved to dead estimates.`)) {
      return;
    }
    try {
      await axios.post(`${API_URL}/jobs/${job._id}/move-to-dead-estimates`);
      toast.success('Job removed from bench');
      await fetchJobs();
    } catch (error) {
      console.error('Error removing job from bench:', error);
      toast.error('Failed to remove job from bench');
    }
  };

  const readCalendarJobDrag = (event) => {
    try {
      const raw = event.dataTransfer.getData('text/plain');
      const parsed = JSON.parse(raw || '{}');
      if (!parsed?.jobId) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const handleCalendarJobDragStart = (event, job, from) => {
    event.dataTransfer.setData(
      'text/plain',
      JSON.stringify({ jobId: job._id, from }),
    );
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDropOnBench = async (event) => {
    event.preventDefault();
    setBenchDropActive(false);
    const payload = readCalendarJobDrag(event);
    if (!payload?.jobId || payload.from !== 'scheduled') return;
    if (!canModifyCalendarWithPin()) {
      toast.error('You do not have permission to modify calendar events');
      return;
    }
    const job =
      scheduledJobsRef.current.find((row) => String(row._id) === String(payload.jobId)) ||
      allJobsRef.current.find((row) => String(row._id) === String(payload.jobId));
    if (!job) return;
    try {
      await axios.patch(`${API_URL}/jobs/${job._id}`, {
        schedule: scheduleFieldsFromJob(job, { returnToBench: true }),
      });
      toast.success('Back on the bench — schedule and color kept');
      await fetchJobs();
    } catch (error) {
      console.error('Error returning job to bench:', error);
      toast.error('Failed to move job to bench');
    }
  };

  const handlePrintBench = async () => {
    const jobs = await Promise.all(
      benchJobs.map(async (job) => {
        if (jobSiteAddress(job)) return job;
        try {
          const response = await axios.get(`${API_URL}/jobs/${job._id}`);
          return response.data || job;
        } catch {
          return job;
        }
      }),
    );
    writeCalendarBenchPrintData(buildCalendarBenchPrintData(jobs, { hideSensitive }));
    window.open('/print/calendar-bench', '_blank', 'noopener,noreferrer');
  };

  const handleDropOnScheduled = async (event) => {
    event.preventDefault();
    setScheduledDropActive(false);
    const payload = readCalendarJobDrag(event);
    if (!payload?.jobId || payload.from !== 'bench') return;
    if (!canModifyCalendarWithPin()) {
      toast.error('You do not have permission to modify calendar events');
      return;
    }
    const job =
      benchJobsRef.current.find((row) => String(row._id) === String(payload.jobId)) ||
      allJobsRef.current.find((row) => String(row._id) === String(payload.jobId));
    if (!job) return;
    if (!hasCalendarSchedule(job)) {
      toast.error('Schedule dates first, or drop this card on a calendar day');
      return;
    }
    try {
      await axios.patch(`${API_URL}/jobs/${job._id}`, {
        schedule: scheduleFieldsFromJob(job, { returnToBench: false }),
      });
      toast.success('Moved to scheduled — dates unchanged');
      await fetchJobs();
    } catch (error) {
      console.error('Error moving job to scheduled:', error);
      toast.error('Failed to move job to scheduled');
    }
  };

  const handlePrevMonth = () => {
    setCurrentDate(addMonths(currentDate, -1));
  };

  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Swipe the month grid sideways to page through months (phones only).
  const swipeStartRef = useRef(null);

  const handleCalendarTouchStart = (event) => {
    const touch = event.touches?.[0];
    swipeStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleCalendarTouchEnd = (event) => {
    const start = swipeStartRef.current;
    const touch = event.changedTouches?.[0];
    swipeStartRef.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Mostly-horizontal and far enough to be deliberate, so vertical scrolling still wins.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) handleNextMonth();
    else handlePrevMonth();
  };

  const effectiveHiddenWeekdays = tvMode ? [] : hiddenWeekdays;
  const visibleWeekdays = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].filter((d) => !effectiveHiddenWeekdays.includes(d)),
    [effectiveHiddenWeekdays]
  );

  const handlePrintCalendar = () => {
    writeCalendarMonthsPrintData(
      buildCalendarMonthsPrintData({
        currentDate,
        events: calendarEvents,
        holidayMap,
        hiddenWeekdays: effectiveHiddenWeekdays,
      }),
    );
    window.open('/print/calendar-months', '_blank', 'noopener,noreferrer');
  };

  const handleDayContextMenu = (date, e) => {
    e.preventDefault();
    setDayContextMenu({
      left: e.clientX,
      top: e.clientY,
      date,
    });
  };

  const handleCloseDayContextMenu = () => setDayContextMenu(null);

  // Slightly taller than square on phones so the day number and job bars both breathe.
  const dayCellAspectRatio = tvMode ? '1.6' : mobileViewOnly ? '0.9' : '1';

  // Phone-only list under the grid: everything still to come, soonest first.
  const mobileUpcomingJobs = useMemo(() => {
    if (!mobileViewOnly) return [];
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return calendarEvents
      .filter((event) => {
        const end = event.schedule?.endDate || event.schedule?.startDate;
        return end && format(new Date(end), 'yyyy-MM-dd') >= todayStr;
      })
      .map(scheduledEventSummary)
      .sort((a, b) => (a.startDate?.getTime() || 0) - (b.startDate?.getTime() || 0))
      .slice(0, 15);
  }, [calendarEvents, mobileViewOnly]);

  const toggleWeekdayHidden = (weekday) => {
    setHiddenWeekdays((prev) =>
      prev.includes(weekday) ? prev.filter((d) => d !== weekday) : [...prev, weekday].sort((a, b) => a - b)
    );
    setDayContextMenu(null);
  };

  // Render a single month calendar
  const renderMonth = (monthDate, monthIndex) => {
    const calendarDays = getCalendarDaysForMonth(monthDate);
    const visibleDays = calendarDays.filter((d) => !effectiveHiddenWeekdays.includes(d.getDay()));
    const columnCount = visibleWeekdays.length;

    return (
      <Box key={monthIndex} sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Month Header - hide on mobile since it's in the main header */}
        {!isMobile && (
          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
              mb: tvMode ? 0.25 : 0.5,
              textAlign: 'center',
              fontSize: tvMode ? { xs: '0.9rem', sm: '1rem' } : { xs: '1rem', sm: '1.15rem' },
            }}
          >
            {format(monthDate, 'MMMM yyyy')}
          </Typography>
        )}

        {/* Day Headers - only visible weekdays */}
        <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columnCount}, 1fr)`, mb: 0, gap: 0 }}>
          {visibleWeekdays.map((dayIndex) => (
            <Paper
              key={dayIndex}
              sx={{
                p: tvMode ? 0.25 : 0.5,
                textAlign: 'center',
                backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5',
                border: `1px solid ${theme.palette.divider}`,
                fontWeight: 600,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontSize: tvMode ? { xs: '0.65rem', sm: '0.7rem' } : { xs: '0.75rem', sm: '0.8rem' },
                  lineHeight: 1.1,
                }}
              >
                {isMobile ? WEEKDAY_LABELS[dayIndex].substring(0, 1) : WEEKDAY_LABELS[dayIndex].substring(0, 3)}
              </Typography>
            </Paper>
          ))}
        </Box>

        {/* Calendar Days Grid - only visible weekdays */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
          gridAutoRows: 'auto',
          gap: 0,
          minHeight: 0,
          '& > *': {
            minWidth: 0,
            aspectRatio: dayCellAspectRatio,
          }
        }}>
          {visibleDays.map((date, index) => (
            <Box
              key={index}
              sx={{
                width: '100%',
                minWidth: 0,
                aspectRatio: dayCellAspectRatio,
                display: 'block',
              }}
            >
              <CalendarDay
                key={index}
                date={date}
                isCurrentMonth={isSameMonth(date, monthDate)}
                events={calendarEvents}
                holidayLabel={holidayMap[format(date, 'yyyy-MM-dd')] || ''}
                tvMode={tvMode}
                onDayClick={handleDayClick}
                onEventClick={handleEventClick}
                onEventDelete={handleEventDelete}
                onViewJob={(id) => setJobIdForDetailModal(id)}
                onDayContextMenu={mobileViewOnly ? undefined : handleDayContextMenu}
                installerOrder={installerOrder}
                viewOnly={mobileViewOnly}
              />
            </Box>
          ))}
        </Box>
      </Box>
    );
  };

  const renderCalendarContent = () =>
    loading ? (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    ) : (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: tvMode ? { xs: 0.35, sm: 0.5 } : { xs: 1, sm: 1.5 } }}>
        {months.map((monthDate, index) => renderMonth(monthDate, index))}
      </Box>
    );

  const renderBenchPanelContent = (placement) => {
    const isVertical = placement !== 'right';
    const resizeEdge = placement === 'top' ? 'bottom' : placement === 'bottom' ? 'top' : 'left';
    return (
      <>
        {/* Minimize/Expand Button */}
        <Box
          sx={{
            position: 'absolute',
            ...(placement === 'right'
              ? { top: isBenchMinimized ? 0 : 4, right: 4 }
              : { top: isBenchMinimized ? 0 : -3, right: 8 }),
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          <Tooltip title="Bench settings">
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                setBenchSettingsAnchor(e.currentTarget);
              }}
              size="small"
              sx={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                '&:hover': {
                  backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5',
                },
              }}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={benchSettingsAnchor}
            open={Boolean(benchSettingsAnchor)}
            onClose={() => setBenchSettingsAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {!tvMode ? (
              <MenuItem
                onClick={() => {
                  setBenchSettingsAnchor(null);
                  handlePrintBench();
                }}
              >
                <ListItemIcon>
                  <PrintIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Print bench" />
              </MenuItem>
            ) : null}
            {!tvMode ? (
              <MenuItem
                onClick={() => {
                  setBenchSettingsAnchor(null);
                  handlePrintCalendar();
                }}
              >
                <ListItemIcon>
                  <PrintIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Print calendar" />
              </MenuItem>
            ) : null}
            <MenuItem
              onClick={() => {
                setBenchSettingsAnchor(null);
                openInstallerSettings();
              }}
            >
              <ListItemIcon>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Installer order" />
            </MenuItem>
          </Menu>
          <IconButton
            onClick={() => {
              setIsBenchMinimized(!isBenchMinimized);
              if (!isBenchMinimized && benchHeight < 150) setBenchHeight(250);
            }}
            size="small"
            sx={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5',
              },
            }}
            title={isBenchMinimized ? 'Expand Bench' : 'Minimize Bench'}
          >
            {isBenchMinimized ? <ExpandMoreIcon /> : <ExpandLessIcon />}
          </IconButton>
        </Box>

        {/* Resize Handle - vertical (top/bottom) or horizontal (right) */}
        {!isBenchMinimized && isVertical && (
          <Box
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsResizing(true);
              const startY = e.clientY;
              const startHeight = benchHeight;
              const handleMouseMove = (moveEvent) => {
                moveEvent.preventDefault();
                const deltaY = placement === 'bottom' ? startY - moveEvent.clientY : moveEvent.clientY - startY;
                const newHeight = Math.max(150, Math.min(600, startHeight + deltaY));
                setBenchHeight(newHeight);
              };
              const handleMouseUp = () => {
                setIsResizing(false);
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };
              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              ...(resizeEdge === 'top' ? { top: -3, height: '16px' } : { bottom: -3, height: '16px' }),
              cursor: 'ns-resize',
              backgroundColor: 'transparent',
              zIndex: 10,
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.05)',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '40px',
                  height: '4px',
                  backgroundColor: '#999',
                  borderRadius: '2px',
                },
              },
            }}
          />
        )}

        {!isBenchMinimized && placement === 'right' && (
          <Box
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const startX = e.clientX;
              const startWidth = benchWidth;
              const handleMouseMove = (moveEvent) => {
                moveEvent.preventDefault();
                const deltaX = startX - moveEvent.clientX;
                const newWidth = Math.max(280, Math.min(600, startWidth + deltaX));
                setBenchWidth(newWidth);
              };
              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };
              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
            sx={{
              position: 'absolute',
              left: -3,
              top: 0,
              bottom: 0,
              width: '16px',
              cursor: 'ew-resize',
              backgroundColor: 'transparent',
              zIndex: 10,
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.05)',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '4px',
                  height: '40px',
                  backgroundColor: '#999',
                  borderRadius: '2px',
                },
              },
            }}
          />
        )}

        {isBenchMinimized ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: { xs: 1, sm: 2 },
              py: 1,
              height: '100%',
              cursor: 'pointer',
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5',
              },
            }}
            onClick={() => setIsBenchMinimized(false)}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
              Bench ({benchJobs.length}) • Scheduled ({scheduledJobs.length})
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.65rem', sm: '0.75rem' } }}>
              Tap to expand
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: placement === 'right' ? 'column' : { xs: 'column', md: 'row' }, gap: { xs: 2, md: 3 }, height: '100%', mt: 1, flexWrap: placement === 'right' ? 'nowrap' : undefined }}>
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                borderRadius: 1,
                outline: benchDropActive ? '2px dashed #1976D2' : '2px dashed transparent',
                backgroundColor: benchDropActive ? 'rgba(25, 118, 210, 0.06)' : 'transparent',
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setBenchDropActive(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setBenchDropActive(false);
              }}
              onDrop={handleDropOnBench}
            >
              <Typography variant="h6" sx={{ fontWeight: 800, mb: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
                Bench ({benchJobs.length})
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 1, sm: 2 } }}>
                {benchJobs.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No jobs on bench</Typography>
                ) : (
                  benchJobs.map((job) => (
                    <BenchJobCard
                      key={job._id}
                      job={job}
                      draggable={!tvMode && canModifyCalendar()}
                      onDragStart={(e, j) => handleCalendarJobDragStart(e, j, 'bench')}
                      onJobClick={(j) => {
                        if (!canModifyCalendarWithPin()) {
                          toast.error('You do not have permission to modify calendar events');
                          return;
                        }
                        setSelectedJob(j);
                        setSelectedInstaller('');
                        setSelectedDate(new Date());
                        setEventModalOpen(true);
                      }}
                      onViewJob={(id) => setJobIdForDetailModal(id)}
                      onRemoveFromBench={isReturnedToBench(job) ? undefined : handleRemoveFromBench}
                    />
                  ))
                )}
              </Box>
            </Box>
            <Box sx={{
              flex: 1,
              minWidth: 0,
              borderLeft: placement === 'right' ? 'none' : { xs: 'none', md: '1px solid #e0e0e0' },
              borderTop: placement === 'right' ? '1px solid #e0e0e0' : { xs: '1px solid #e0e0e0', md: 'none' },
              pl: { xs: 0, md: placement === 'right' ? 0 : 3 },
              pt: { xs: 2, md: 0 },
              borderRadius: 1,
              outline: scheduledDropActive ? '2px dashed #4caf50' : '2px dashed transparent',
              backgroundColor: scheduledDropActive ? 'rgba(76, 175, 80, 0.06)' : 'transparent',
            }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setScheduledDropActive(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setScheduledDropActive(false);
              }}
              onDrop={handleDropOnScheduled}
            >
              <Typography variant="h6" sx={{ fontWeight: 800, mb: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
                Scheduled ({scheduledJobs.length})
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 1, sm: 2 } }}>
                {scheduledJobs.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No scheduled jobs</Typography>
                ) : (
                  scheduledJobs.map((job) => (
                    <ScheduledJobCard
                      key={job._id}
                      job={job}
                      draggable={!tvMode && canModifyCalendar()}
                      onDragStart={(e, j) => handleCalendarJobDragStart(e, j, 'scheduled')}
                      onJobClick={(j) => {
                        if (!canModifyCalendarWithPin()) {
                          toast.error('You do not have permission to modify calendar events');
                          return;
                        }
                        setSelectedJob(j);
                        setSelectedInstaller(
                          j?.schedule?.installer ||
                            (Array.isArray(j?.schedule?.installers) ? j.schedule.installers?.[0] : '') ||
                            ''
                        );
                        setSelectedDate(j.schedule?.startDate ? new Date(j.schedule.startDate) : new Date());
                        setEventModalOpen(true);
                      }}
                      onJobDelete={handleEventDelete}
                      onViewJob={(id) => setJobIdForDetailModal(id)}
                    />
                  ))
                )}
              </Box>
            </Box>
          </Box>
        )}
      </>
    );
  };

  // On phones the height subtracts the top bar + layout padding so the bench isn't pushed below the fold.
  return (
    <Box sx={{ height: { xs: 'calc(100dvh - 80px)', md: '100vh' }, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ 
        p: tvMode ? { xs: 0.5, sm: 1 } : { xs: 1, sm: 2 }, 
        borderBottom: '1px solid #e0e0e0', 
        display: 'flex', 
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'space-between', 
        alignItems: { xs: 'stretch', sm: 'center' },
        gap: { xs: 1, sm: 1.5 }
      }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: { xs: 1, sm: 2 },
            flexWrap: 'wrap',
            width: 'auto',
          }}
        >
          <IconButton onClick={handlePrevMonth} size="small">
            <ChevronLeftIcon />
          </IconButton>
          <Typography 
            variant="h5" 
            sx={{ 
              fontWeight: 600, 
              minWidth: { xs: 'auto', sm: 200 }, 
              textAlign: 'center',
              fontSize: tvMode ? { xs: '0.8rem', sm: '1rem', md: '1.2rem' } : { xs: '0.875rem', sm: '1.25rem', md: '1.5rem' }
            }}
          >
            {isMobile 
              ? format(currentDate, 'MMMM yyyy')
              : tvMode
                ? `${format(currentDate, 'MMMM yyyy')} - ${format(addMonths(currentDate, 1), 'MMMM yyyy')}`
                : `${format(currentDate, 'MMMM yyyy')} - ${format(addMonths(currentDate, 2), 'MMMM yyyy')}`
            }
          </Typography>
          <IconButton onClick={handleNextMonth} size="small">
            <ChevronRightIcon />
          </IconButton>
          <Button
            startIcon={<TodayIcon />}
            onClick={handleToday}
            variant="outlined"
            size="small"
            sx={{ display: mobileViewOnly ? 'flex' : { xs: 'none', sm: 'flex' } }}
          >
            Today
          </Button>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {tvMode && !externalViewControls ? (
            <>
              <Button
                onClick={() => navigate('/pipeline-view')}
                variant="outlined"
                size="small"
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Pipeline view
              </Button>
              <Button
                onClick={() => navigate('/calendar-view')}
                variant="contained"
                size="small"
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Calendar view
              </Button>
              <Button
                onClick={() => navigate('/customers-view')}
                variant="outlined"
                size="small"
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Customers view
              </Button>
              <Button
                onClick={() => navigate('/calendar')}
                variant="contained"
                size="small"
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Exit Calendar view
              </Button>
            </>
          ) : null}
          {tvMode && !externalViewControls && (
            <Button
              onClick={() => navigate('/calendar')}
              variant="outlined"
              size="small"
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            >
              Exit Calendar view
            </Button>
          )}
          {tvMode && (
            <Button
              onClick={toggleColorMode}
              variant="outlined"
              size="small"
              startIcon={mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            >
              {mode === 'dark' ? 'Light mode' : 'Dark mode'}
            </Button>
          )}
        </Box>
      </Box>

      {/* Phones: calendar only — the bench and scheduled lists are desktop tools. */}
      {mobileViewOnly && (
        <Box sx={{ flex: 1, overflow: 'auto', p: 0.5, minHeight: 0 }}>
          <Box onTouchStart={handleCalendarTouchStart} onTouchEnd={handleCalendarTouchEnd}>
            {renderCalendarContent()}
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center', mt: 0.75, fontStyle: 'italic' }}
          >
            Swipe the calendar for another month. Tap any day to see that week&apos;s breakdown.
          </Typography>

          <Box sx={{ mt: 2, pb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Upcoming jobs
            </Typography>
            {mobileUpcomingJobs.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing is scheduled from today onward.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {mobileUpcomingJobs.map((summary) => (
                  <Paper
                    key={summary.key}
                    variant="outlined"
                    onClick={() => summary.startDate && setMobileWeekDate(summary.startDate)}
                    sx={{
                      p: 1.25,
                      borderLeft: `4px solid ${summary.color}`,
                      cursor: 'pointer',
                      opacity: summary.closedOut ? 0.75 : 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }}>
                        {summary.customerName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                        {summary.shortDateLabel}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {[summary.installer || 'Unassigned', summary.location].filter(Boolean).join(' \u00b7 ')}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Main area: layout depends on bench position */}
      {!mobileViewOnly && benchPosition === 'top' && (
        <>
          {/* Bench at top */}
          <Box
            sx={{
              flexShrink: 0,
              backgroundColor: theme.palette.background.paper,
              borderBottom: `3px solid ${theme.palette.divider}`,
              p: isBenchMinimized ? 0 : { xs: 1, sm: 2 },
              height: isBenchMinimized ? '40px' : isMobile ? '200px' : `${benchHeight}px`,
              overflow: isBenchMinimized ? 'hidden' : 'auto',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              transition: 'height 0.3s ease, padding 0.3s ease',
            }}
          >
            {renderBenchPanelContent('top')}
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 0.5, sm: 1 }, minHeight: 0 }}>
            {renderCalendarContent()}
          </Box>
        </>
      )}

      {!mobileViewOnly && benchPosition === 'right' && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, overflow: 'hidden' }}>
          <Box sx={{ flex: 1, overflow: 'auto', p: tvMode ? { xs: 0.2, sm: 0.4 } : { xs: 0.5, sm: 1 }, minWidth: 0 }}>
            {renderCalendarContent()}
          </Box>
          <Box
            sx={{
              flexShrink: 0,
              width: isBenchMinimized ? 48 : benchWidth,
              backgroundColor: theme.palette.background.paper,
              borderLeft: `3px solid ${theme.palette.divider}`,
              p: isBenchMinimized ? 0 : tvMode ? { xs: 0.5, sm: 0.75 } : { xs: 1, sm: 2 },
              overflow: isBenchMinimized ? 'hidden' : 'auto',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              transition: 'width 0.3s ease',
            }}
          >
            {renderBenchPanelContent('right')}
          </Box>
        </Box>
      )}

      {!mobileViewOnly && benchPosition === 'bottom' && (
        <>
          <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 0.5, sm: 1 }, minHeight: 0 }}>
            {renderCalendarContent()}
          </Box>
          {/* Bench at bottom - resizable */}
          <Box
            sx={{
              flexShrink: 0,
              backgroundColor: theme.palette.background.paper,
              borderTop: `3px solid ${theme.palette.divider}`,
              p: isBenchMinimized ? 0 : { xs: 1, sm: 2 },
              height: isBenchMinimized ? '40px' : isMobile ? '200px' : `${benchHeight}px`,
              overflow: isBenchMinimized ? 'hidden' : 'auto',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              transition: 'height 0.3s ease, padding 0.3s ease',
            }}
          >
            {renderBenchPanelContent('bottom')}
          </Box>
        </>
      )}

      <MobileWeekScheduleDialog
        open={Boolean(mobileWeekDate)}
        date={mobileWeekDate}
        events={calendarEvents}
        hiddenWeekdays={effectiveHiddenWeekdays}
        onClose={() => setMobileWeekDate(null)}
      />

      {/* Event Modal */}
      <EventModal
        open={eventModalOpen && !mobileViewOnly}
        onClose={() => {
          setEventModalOpen(false);
          setSelectedDate(null);
          setSelectedJob(null);
          setSelectedInstaller('');
        }}
        selectedDate={selectedDate}
        job={selectedJob}
        onSave={fetchJobs}
        onViewJob={(id) => setJobIdForDetailModal(id)}
        installerOptions={installerOrder}
        selectedInstaller={selectedInstaller}
      />

      <Dialog open={installerSettingsOpen} onClose={() => setInstallerSettingsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Installer order settings</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Set the default installer names and order used in calendar lanes and installer suggestions.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {installerDraftOrder.map((name, idx) => (
              <Box key={`installer-draft-${idx}`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TextField
                  size="small"
                  fullWidth
                  label={`Installer ${idx + 1}`}
                  value={name}
                  onChange={(e) => updateInstallerDraftAt(idx, e.target.value)}
                />
                <IconButton size="small" onClick={() => moveInstallerDraft(idx, -1)} disabled={idx === 0}>
                  <ExpandLessIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => moveInstallerDraft(idx, 1)}
                  disabled={idx === installerDraftOrder.length - 1}
                >
                  <ExpandMoreIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => removeInstallerDraft(idx)}
                  disabled={installerDraftOrder.length <= 1}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>
          <Button startIcon={<AddIcon />} onClick={addInstallerDraft} size="small" sx={{ mt: 1.5 }}>
            Add installer
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInstallerSettingsOpen(false)}>Cancel</Button>
          <Button onClick={saveInstallerSettings} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Job detail modal (customer, files, etc.) */}
      <JobDetailModal
        jobId={jobIdForDetailModal}
        open={!!jobIdForDetailModal}
        onClose={() => setJobIdForDetailModal(null)}
        onJobUpdate={handleJobUpdate}
        onJobDataChanged={handleJobDataChanged}
        onJobDelete={(jobId) => {
          setJobIdForDetailModal(null);
          fetchJobs();
        }}
        onJobArchive={(jobId) => {
          setJobIdForDetailModal(null);
          fetchJobs();
        }}
        hideSensitive={hideSensitive}
        onRequestSensitiveUnlock={financialPin.openUnlockDialog}
        shopDisplayMode={tvMode}
      />

      {/* Right-click on a date: hide/show that weekday */}
      <Menu
        open={!!dayContextMenu}
        onClose={handleCloseDayContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          dayContextMenu
            ? { top: dayContextMenu.top, left: dayContextMenu.left }
            : undefined
        }
      >
        {dayContextMenu && (() => {
          const weekday = dayContextMenu.date.getDay();
          const label = WEEKDAY_LABELS[weekday];
          const isHidden = hiddenWeekdays.includes(weekday);
          return (
            <MenuItem
              onClick={() => toggleWeekdayHidden(weekday)}
            >
              {isHidden ? `Show ${label}s` : `Hide ${label}s`}
            </MenuItem>
          );
        })()}
      </Menu>
    </Box>
  );
}

export default CalendarPage;

