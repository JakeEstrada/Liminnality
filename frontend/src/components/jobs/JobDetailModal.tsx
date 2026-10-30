/**
 * JobDetailModal — Full job editor: notes, files, tasks, AI summary.
 * Docs: ../../../docs/COMPONENTS.md
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  Box,
  GridLegacy as Grid,
  Divider,
  Tabs,
  Tab,
  Paper,
  Button,
  CircularProgress,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Link as MuiLink,
  Tooltip,
  Chip,
  Alert,
} from '@mui/material';
import {
  Close as CloseIcon,
  Person as PersonIcon,
  AttachMoney as MoneyIcon,
  CalendarToday as CalendarIcon,
  LocationOn as LocationIcon,
  Description as DescriptionIcon,
  Assignment as AssignmentIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Archive as ArchiveIcon,
  SwapHoriz as SwapHorizIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  InsertDriveFile as InsertDriveFileIcon,
  CloudUpload as CloudUploadIcon,
  Share as ShareIcon,
  Sms as SmsIcon,
  VpnKey as GateIcon,
  AutoAwesome as AutoAwesomeIcon,
  ContentCopy as ContentCopyIcon,
  Lock as LockIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import axios from 'axios';
import PdfThumbnail from '../common/PdfThumbnail';
import AuthenticatedFileImage from '../common/AuthenticatedFileImage';
import toast from 'react-hot-toast';
import AddNoteModal from './AddNoteModal';
import AddJobTaskModal from './AddJobTaskModal';
import AddAppointmentModal from '../appointments/AddAppointmentModal';
import JobCannedSmsDialog from './JobCannedSmsDialog';
import JobMessagesPanel from './JobMessagesPanel';
import JobPaymentScheduleEditor from './JobPaymentScheduleEditor';
import JobChangeOrdersEditor from './JobChangeOrdersEditor';
import JobCoverPagesDialog from './JobCoverPagesDialog';
import JobPaymentsSummary from './JobPaymentsSummary';
import JobSchedulePanel from './JobSchedulePanel';
import EmployeeSmsRecipientField, {
  parseSmsRecipientSelection,
} from '../common/EmployeeSmsRecipientField';
import { formatPhoneForDisplay, telHref } from '../../utils/phoneFormat';
import { buildCustomerShareMessage } from '../../utils/customerShareMessage';
import { useFinancialPinLockContext } from '../../context/FinancialPinLockContext';
import { useAuth } from '../../context/AuthContext';
import { useSocketSubscription } from '../../hooks/useSocketSubscription';
import { getTenantRoom } from '../../services/socket';
import {
  getJobFilesCache,
  invalidateJobFilesCache,
  setJobFilesCache,
} from '../../utils/fileListCache';
import { renderSummaryBlocks } from '../../utils/summaryMarkdown';
import {
  formatMoney,
  getJobTotalWithChangeOrders,
  resolvePaymentSchedule,
  sumChangeOrders,
} from '../../utils/paymentSchedule';
import {
  isShopDisplayPath,
  shopDisplayCalendarPath,
  shopDisplayCustomerPath,
} from '../../utils/shopDisplay';
import { JOB_SOURCE_OPTIONS, formatJobSourceWithCompany, sanitizeMoneyTypingInput, clipReferralCompany } from '../../utils/jobSources';
import { jobMapFixLabel, jobNeedsMapFix } from '../../utils/jobGeo';
import ReferralCompanyField, { rememberReferralCompany } from '../common/ReferralCompanyField';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const openPdfViewer = (fileId) => {
  window.open(`/pdf/${fileId}`, '_blank');
};

const openPictureViewer = (fileId) => {
  window.open(`/picture/${fileId}`, '_blank');
};

const STAGE_LABELS = {
  APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
  ESTIMATE_IN_PROGRESS: 'Estimate Current, first 5 days',
  ESTIMATE_SENT: 'Estimate Sent',
  ENGAGED_DESIGN_REVIEW: 'Design Review',
  CONTRACT_OUT: 'Contract Out',
  CONTRACT_SIGNED: 'Contract Signed',
  DEPOSIT_PENDING: 'Signed / Deposit Pending',
  JOB_PREP: 'Job Prep',
  TAKEOFF_COMPLETE: 'Fabrication',
  READY_TO_SCHEDULE: 'Ready to Schedule',
  SCHEDULED: 'Scheduled',
  IN_PRODUCTION: 'In Production',
  INSTALLED: 'Installed',
  FINAL_PAYMENT_CLOSED: 'Final Payment Closed',
};

// All stages in order
const ALL_STAGES = [
  'APPOINTMENT_SCHEDULED',
  'ESTIMATE_IN_PROGRESS',
  'ESTIMATE_SENT',
  'ENGAGED_DESIGN_REVIEW',
  'CONTRACT_OUT',
  'DEPOSIT_PENDING',
  'JOB_PREP',
  'TAKEOFF_COMPLETE',
  'READY_TO_SCHEDULE',
  'SCHEDULED',
  'IN_PRODUCTION',
  'INSTALLED',
  'FINAL_PAYMENT_CLOSED'
];

// Get next stage
const getNextStage = (currentStage) => {
  const currentIndex = ALL_STAGES.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex === ALL_STAGES.length - 1) {
    return null; // Already at last stage or invalid stage
  }
  return ALL_STAGES[currentIndex + 1];
};

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const URL_PART_REGEX = /^https?:\/\/[^\s]+$/;

function renderTextWithLinks(text) {
  const raw = String(text || '');
  if (!raw) return '';
  const parts = raw.split(URL_REGEX);
  return parts.map((part, index) => {
    if (URL_PART_REGEX.test(part)) {
      return (
        <MuiLink
          key={`link-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          underline="always"
          sx={{ wordBreak: 'break-all' }}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </MuiLink>
      );
    }
    return <Box key={`txt-${index}`} component="span">{part}</Box>;
  });
}

export const JOB_MODAL_TAB = {
  overview: 0,
  messages: 1,
  schedule: 2,
  payments: 3,
  files: 4,
  notes: 5,
};

function resolveJobModalTab(tab) {
  if (typeof tab === 'number' && tab >= 0 && tab <= 5) return tab;
  if (typeof tab === 'string' && tab in JOB_MODAL_TAB) return JOB_MODAL_TAB[tab];
  return JOB_MODAL_TAB.overview;
}

/** Flat, bordered card used for every panel inside the modal body. */
const MODAL_CARD_SX = {
  p: 2,
  width: '100%',
  borderRadius: 2,
  border: '1px solid',
  borderColor: 'divider',
  display: 'flex',
  flexDirection: 'column',
};

/**
 * Job writes and socket payloads populate `customerId` with only name/phone/email,
 * while the detail fetch returns the full customer. Merge so a save never drops the
 * address shown in the header card.
 */
function mergeJobPreservingCustomer(prev, incoming) {
  if (!prev) return incoming || null;
  if (!incoming) return prev;

  const merged = { ...prev, ...incoming };
  const idOf = (value) =>
    value && typeof value === 'object' ? String(value._id || '') : String(value || '');
  const prevCustomer = prev.customerId;
  const nextCustomer = incoming.customerId;

  const sameCustomer = idOf(prevCustomer) && idOf(prevCustomer) === idOf(nextCustomer);
  const nextIsDetailed =
    nextCustomer &&
    typeof nextCustomer === 'object' &&
    (nextCustomer.address || nextCustomer.gateCode);
  if (sameCustomer && prevCustomer && typeof prevCustomer === 'object' && !nextIsDetailed) {
    merged.customerId = prevCustomer;
  }
  return merged;
}

const HEADER_LINK_SX = {
  textTransform: 'none',
  fontSize: '0.8rem',
  fontWeight: 600,
  py: 0.25,
  px: 0.75,
  minWidth: 0,
};

/** Label on the left, amount right-aligned in a fixed column so figures stack cleanly. */
function HeaderMoneyRow({ label, value, muted = false, strong = false, note = '' }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5 }}>
      <Typography
        variant="caption"
        sx={{
          color: muted ? 'text.disabled' : 'text.secondary',
          fontWeight: strong ? 600 : 400,
          lineHeight: 1.5,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        {note ? (
          <Typography component="span" variant="caption" sx={{ color: 'success.main', ml: 0.5 }}>
            {note}
          </Typography>
        ) : null}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          color: muted ? 'text.disabled' : 'text.secondary',
          fontWeight: strong ? 600 : 500,
          lineHeight: 1.5,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function JobDetailModal({
  jobId,
  open,
  onClose,
  onJobUpdate,
  onJobDelete,
  onJobArchive,
  onAppointmentCreated = () => {},
  onJobDataChanged = () => {},
  initialTab = 'overview',
  startEditing = false,
  sx = {},
  hideSensitive = false,
  onRequestSensitiveUnlock = () => {},
  shopDisplayMode = false,
}) {
  const location = useLocation();
  const financialPin = useFinancialPinLockContext();
  const { tenantIdForBranding, isSuperAdmin, user } = useAuth();
  const isShopDisplay = shopDisplayMode || isShopDisplayPath(location.pathname);
  const [activeTab, setActiveTab] = useState(() => resolveJobModalTab(initialTab));
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedJob, setEditedJob] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [fileType] = useState('other');
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addAppointmentOpen, setAddAppointmentOpen] = useState(false);
  const [jobTasks, setJobTasks] = useState([]);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [changeOrdersSaving, setChangeOrdersSaving] = useState(false);
  const hideFinancials = hideSensitive;
  const [coverPagesOpen, setCoverPagesOpen] = useState(false);
  const [cannedSmsOpen, setCannedSmsOpen] = useState(false);
  const [messagesRefreshKey, setMessagesRefreshKey] = useState(0);
  const startEditingRef = useRef(Boolean(startEditing));
  startEditingRef.current = Boolean(startEditing);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareSmsRecipient, setShareSmsRecipient] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [sendingShare, setSendingShare] = useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState('');
  const [aiSummaryPrompt, setAiSummaryPrompt] = useState('');
  const [aiSummaryMeta, setAiSummaryMeta] = useState(null);

  const fetchJobFiles = useCallback(async ({ force = false } = {}) => {
    const jobKey = String(jobId || '');
    if (!jobKey) return;

    const cached = getJobFilesCache(jobKey);
    if (cached && !force) {
      setFiles(cached);
    }

    try {
      const response = await axios.get(`${API_URL}/files/job/${jobKey}`);
      const list = Array.isArray(response.data) ? response.data : [];
      setJobFilesCache(jobKey, list);
      setFiles(list);
    } catch (error) {
      console.error('Error fetching files:', error);
      if (!cached) setFiles([]);
    }
  }, [jobId]);

  // Callers usually pass an inline onClose, so keep it in a ref: putting it in the
  // fetch dependencies re-created the callback every parent render, which re-ran the
  // load effect (refetching everything and resetting the active tab) on each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const fetchJobTasks = useCallback(async () => {
    if (!jobId) return;
    try {
      const tasksResponse = await axios.get(`${API_URL}/tasks/job/${jobId}`);
      setJobTasks(Array.isArray(tasksResponse.data) ? tasksResponse.data : []);
    } catch (taskError) {
      console.error('Error fetching job tasks:', taskError);
      setJobTasks([]);
    }
  }, [jobId]);

  const fetchJobDetails = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/jobs/${jobId}`);
      setJob(response.data);
      setEditedJob(response.data);
      setIsEditing(Boolean(startEditingRef.current));
      if (startEditingRef.current) {
        setActiveTab(JOB_MODAL_TAB.overview);
      }
      await fetchJobTasks();
    } catch (error) {
      console.error('Error fetching job details:', error);
      toast.error('Failed to load job details');
      onCloseRef.current?.();
    } finally {
      setLoading(false);
    }
  }, [jobId, fetchJobTasks]);

  /**
   * Writes return the updated job, so render it straight away instead of racing a
   * refetch against the parent's own background refresh.
   */
  const applySavedJob = useCallback(
    (savedJob) => {
      if (savedJob && typeof savedJob === 'object' && savedJob._id) {
        setJob((prev) => mergeJobPreservingCustomer(prev, savedJob));
        setEditedJob((prev) => mergeJobPreservingCustomer(prev, savedJob));
        return;
      }
      fetchJobDetails();
    },
    [fetchJobDetails],
  );

  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const handleRealtimeJobPatch = useCallback(
    (payload) => {
      const incoming = payload?.patch || payload?.project;
      const entityId = String(payload?.entityId || incoming?._id || '').trim();
      if (!incoming || !entityId || entityId !== String(jobId || '')) return;
      if (incoming.deleted) return;
      // Merge into the displayed job only — in-progress edits live in editedJob.
      setJob((prev) => (prev ? mergeJobPreservingCustomer(prev, incoming) : prev));
    },
    [jobId],
  );
  useSocketSubscription(tenantRoom, 'project.updated', handleRealtimeJobPatch);

  const handleRealtimeJobTaskChange = useCallback(
    (payload) => {
      const incoming = payload?.patch || payload?.task;
      const taskJobId = incoming?.jobId?._id || incoming?.jobId;
      if (!taskJobId || String(taskJobId) !== String(jobId || '')) return;
      fetchJobTasks();
    },
    [jobId, fetchJobTasks],
  );
  useSocketSubscription(tenantRoom, 'task.created', handleRealtimeJobTaskChange);
  useSocketSubscription(tenantRoom, 'task.updated', handleRealtimeJobTaskChange);

  const handleRealtimeCustomer = useCallback(
    (payload: unknown) => {
      const data = payload as { customer?: { _id?: string; gateCode?: string }; entityId?: string; action?: string };
      const incoming = data?.customer;
      const entityId = String(data?.entityId || incoming?._id || '').trim();
      if (!incoming || !entityId || data?.action === 'deleted') return;
      const patchCustomer = (prev) => {
        if (!prev) return prev;
        const cust = prev.customerId;
        const custId = cust && typeof cust === 'object' ? cust._id : cust;
        if (String(custId || '') !== entityId) return prev;
        const nextCustomer = typeof cust === 'object' && cust ? { ...cust, ...incoming } : incoming;
        return { ...prev, customerId: nextCustomer };
      };
      setJob(patchCustomer);
      setEditedJob(patchCustomer);
    },
    [],
  );
  useSocketSubscription(tenantRoom, 'customer.changed', handleRealtimeCustomer);

  useEffect(() => {
    if (open && jobId) {
      setActiveTab(resolveJobModalTab(initialTab));
      setJob((prev) => (prev && String(prev._id) === String(jobId) ? prev : null));
      setEditedJob((prev) => (prev && String(prev._id) === String(jobId) ? prev : null));
      setFiles([]);
      setJobTasks([]);
      setIsEditing(false);
      setAiSummaryOpen(false);
      setAiSummaryText('');
      setAiSummaryMeta(null);
      setMessagesRefreshKey((key) => key + 1);
      fetchJobDetails();
      fetchJobFiles();
    } else {
      setIsEditing(false);
      setEditedJob(null);
    }
  }, [open, jobId, initialTab, fetchJobDetails, fetchJobFiles]);

  const validateUploadFile = (file) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return 'Only images and PDFs are allowed';
    }
    if (file.size > 10 * 1024 * 1024) {
      return 'File must be less than 10MB';
    }
    return null;
  };

  const uploadOneFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('jobId', jobId);
    formData.append('fileType', fileType);
    await axios.post(`${API_URL}/files/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  };

  const handleUploadFiles = async (fileList, resetInput = null) => {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;

    const valid = [];
    const skipped = [];
    for (const file of files) {
      const reason = validateUploadFile(file);
      if (reason) skipped.push({ name: file.name, reason });
      else valid.push(file);
    }

    if (skipped.length) {
      const first = skipped[0];
      const more = skipped.length > 1 ? ` (+${skipped.length - 1} more skipped)` : '';
      toast.error(`${first.name}: ${first.reason}${more}`);
    }
    if (!valid.length) return;

    setUploading(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (let i = 0; i < valid.length; i += 1) {
        const file = valid[i];
        try {
          await uploadOneFile(file);
          succeeded += 1;
        } catch (error) {
          failed += 1;
          console.error('Error uploading file:', file.name, error);
        }
      }
      await fetchJobFiles({ force: true });
      if (resetInput) resetInput.value = '';
      if (succeeded && !failed) {
        toast.success(succeeded === 1 ? 'File uploaded successfully' : `Uploaded ${succeeded} files`);
      } else if (succeeded && failed) {
        toast.error(`Uploaded ${succeeded} of ${valid.length} files`);
      } else {
        toast.error('Failed to upload files');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);

    if (e.dataTransfer.files?.length) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files?.length) {
      handleUploadFiles(e.target.files, e.target);
    }
  };

  const headerBaseEstimatedValue = Number((isEditing ? editedJob?.valueEstimated : job?.valueEstimated) || 0);
  const headerContractedValue = Number((isEditing ? editedJob?.valueContracted : job?.valueContracted) || 0);
  const headerContractBase = headerContractedValue > 0 ? headerContractedValue : headerBaseEstimatedValue;
  const headerScheduleSource = isEditing ? editedJob || job : job;
  const headerChangeOrderValue = sumChangeOrders(headerScheduleSource);
  const headerFullTotal = getJobTotalWithChangeOrders({
    ...headerScheduleSource,
    valueEstimated: headerBaseEstimatedValue,
    valueContracted: headerContractedValue,
  });
  const headerPaymentSchedule = resolvePaymentSchedule({
    ...headerScheduleSource,
    valueEstimated: headerBaseEstimatedValue,
    valueContracted: headerContractedValue,
  });
  const jobCardId = job?._id ? String(job._id).slice(-6).toUpperCase() : 'N/A';

  const handleFileDelete = async (fileId) => {
    if (!window.confirm('Are you sure you want to delete this file?')) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/files/${fileId}`);
      toast.success('File deleted successfully');
      await fetchJobFiles({ force: true });
    } catch (error) {
      console.error('Error deleting file:', error);
      toast.error('Failed to delete file');
    }
  };

  const openFileByType = (file) => {
    if (!file?._id) return;
    if (file.mimetype?.startsWith('image/')) {
      openPictureViewer(file._id);
      return;
    }
    if (file.mimetype === 'application/pdf') {
      openPdfViewer(file._id);
      return;
    }
    window.open(`${API_URL}/files/${file._id}/download`, '_blank', 'noopener,noreferrer');
  };

  const handleFileCardClick = (file) => {
    if (!file) return;
    openFileByType(file);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditedJob({ ...job });
    setActiveTab(JOB_MODAL_TAB.overview);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedJob({ ...job });
  };

  const handleSavePaymentSchedule = async (paymentSchedule) => {
    try {
      setScheduleSaving(true);
      await onJobUpdate(jobId, { paymentSchedule });
      await fetchJobDetails();
      if (paymentSchedule) {
        toast.success('Payment schedule saved');
      }
    } catch (error) {
      console.error('Error saving payment schedule:', error);
      toast.error('Failed to save payment schedule');
      throw error;
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleSaveChangeOrders = async (changeOrders) => {
    try {
      setChangeOrdersSaving(true);
      await onJobUpdate(jobId, {
        changeOrders: changeOrders.map((row) => ({
          description: row.description,
          amount: row.amount,
          billing: row.billing,
        })),
      });
      await fetchJobDetails();
      toast.success('Change orders saved');
    } catch (error) {
      console.error('Error saving change orders:', error);
      toast.error('Failed to save change orders');
      throw error;
    } finally {
      setChangeOrdersSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const jobAddress = {
        street: String(editedJob?.jobAddress?.street || '').trim(),
        city: String(editedJob?.jobAddress?.city || '').trim(),
        state: String(editedJob?.jobAddress?.state || '').trim(),
        zip: String(editedJob?.jobAddress?.zip || '').trim(),
      };
      const updates = {
        title: editedJob.title,
        description: editedJob.description || '',
        valueEstimated:
          editedJob.valueEstimated === '' || editedJob.valueEstimated == null
            ? 0
            : parseFloat(String(editedJob.valueEstimated)) || 0,
        valueContracted: editedJob.valueContracted,
        source: editedJob.source,
        referralCompany:
          editedJob.source === 'referral' ? clipReferralCompany(editedJob.referralCompany) : '',
        jobAddress,
        geo: (() => {
          const lat = Number(editedJob?.geo?.lat);
          const lng = Number(editedJob?.geo?.lng);
          const prevLat = Number(job?.geo?.lat);
          const prevLng = Number(job?.geo?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
          if (lat === prevLat && lng === prevLng) return undefined;
          return { lat, lng };
        })(),
      };

      await onJobUpdate(jobId, updates);
      if (updates.source === 'referral' && updates.referralCompany) {
        rememberReferralCompany(updates.referralCompany);
      }
      setIsEditing(false);
      await fetchJobDetails(); // Refresh job data
      toast.success('Job updated successfully');
    } catch (error) {
      console.error('Error saving job:', error);
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (field, value) => {
    setEditedJob((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'source' && value !== 'referral' ? { referralCompany: '' } : {}),
    }));
  };

  const handleJobAddressFieldChange = (field, value) => {
    setEditedJob((prev) => ({
      ...prev,
      jobAddress: {
        ...(prev?.jobAddress || {}),
        [field]: value,
      },
    }));
  };

  const handleGeoFieldChange = (field, value) => {
    setEditedJob((prev) => ({
      ...prev,
      geo: {
        ...(prev?.geo || {}),
        [field]: value,
      },
    }));
  };

  const handleDeleteClick = () => {
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      setDeleting(true);
      await axios.delete(`${API_URL}/jobs/${jobId}`);
      invalidateJobFilesCache(jobId);
      toast.success('Job deleted successfully');
      setDeleteConfirmOpen(false);
      if (onJobDelete) {
        onJobDelete(jobId);
      }
      onClose();
    } catch (error) {
      console.error('Error deleting job:', error);
      toast.error('Failed to delete job');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmOpen(false);
  };

  const handleArchive = async () => {
    try {
      setSaving(true);
      await axios.post(`${API_URL}/jobs/${jobId}/archive`);
      toast.success('Job archived successfully');
      if (onJobArchive) {
        onJobArchive(jobId);
      }
      onClose();
    } catch (error) {
      console.error('Error archiving job:', error);
      toast.error('Failed to archive job');
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = formatMoney;

  const formatDate = (date) => {
    if (!date) return 'Not set';
    return format(new Date(date), 'MMM dd, yyyy');
  };

  const formatDateTime = (date) => {
    if (!date) return 'Not set';
    return format(new Date(date), 'MMM dd, yyyy h:mm a');
  };

  const getNoteAuthor = (note) =>
    note?.createdBy?.name || note?.createdByName || job?.createdBy?.name || 'Unknown';

  const noteBorderColor = (note) => {
    if (note?.important) return 'error.main';
    if (note?.isSms) return note.smsDirection === 'inbound' ? 'success.main' : 'info.main';
    if (note?.isStageChange) return 'primary.main';
    if (note?.isAppointment) return 'warning.main';
    return 'divider';
  };

  const noteTextColor = (note) => {
    if (note?.important) return 'error.main';
    if (note?.isSms) return note.smsDirection === 'inbound' ? 'success.dark' : 'info.dark';
    if (note?.isStageChange) return 'primary.main';
    if (note?.isAppointment) return 'warning.main';
    return 'text.primary';
  };

  /** Job site / customer address + contact for header strip */
  const getCustomerContact = (j) => {
    if (!j) return { name: '', addressLine: '', email: '', phone: '', gateCode: '' };
    const cust = j.customerId && typeof j.customerId === 'object' ? j.customerId : null;
    const ja = j.jobAddress;
    let addressLine = '';
    if (ja && (ja.street || ja.city || ja.state || ja.zip)) {
      addressLine = [ja.street, ja.city, ja.state, ja.zip].filter(Boolean).join(', ');
    } else if (cust?.address && (cust.address.street || cust.address.city || cust.address.state || cust.address.zip)) {
      addressLine = [cust.address.street, cust.address.city, cust.address.state, cust.address.zip]
        .filter(Boolean)
        .join(', ');
    }
    const contactEmails = Array.isArray(cust?.contactEmails)
      ? cust.contactEmails.map((row) => row?.value).filter((value) => String(value || '').trim())
      : [];
    const emails = (contactEmails.length
      ? contactEmails
      : [cust?.primaryEmail, ...(Array.isArray(cust?.emails) ? cust.emails : []), j.jobContact?.email]
    )
      .map((value) => String(value || '').trim())
      .filter((value, index, list) => value && list.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
    const email = emails.join(', ');
    const phone = j.jobContact?.phone || cust?.primaryPhone || '';
    const name = cust?.name || '';
    const gateCode = String(cust?.gateCode || '').trim();
    return { name, addressLine, email, phone, gateCode };
  };

  const buildJobShareMessage = (j) => {
    const { name, addressLine, email, phone, gateCode } = getCustomerContact(j);
    const cust = j?.customerId && typeof j.customerId === 'object' ? j.customerId : { name };
    return buildCustomerShareMessage({
      customer: { ...cust, name: name || cust.name, gateCode: gateCode || cust.gateCode },
      jobTitle: j?.title,
      address: addressLine,
      extraPhones: phone ? [phone] : [],
      extraEmail: email,
    });
  };

  useEffect(() => {
    if (!shareDialogOpen || !job) return;
    setShareMessage(buildJobShareMessage(job));
  }, [shareDialogOpen, job]);

  const renderCustomerHeaderStrip = (j) => {
    const { name, addressLine, email, phone, gateCode } = getCustomerContact(j);
    if (!name && !addressLine && !email && !phone && !gateCode) return null;
    const smallText = { fontSize: '0.7rem', lineHeight: 1.4 };
    const iconSm = { fontSize: 14, flexShrink: 0 };
    return (
      <Box
        sx={{
          mt: 0.5,
          py: 0.75,
          px: 1,
          borderRadius: 0.75,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'action.hover',
          display: 'inline-flex',
          flexDirection: 'column',
          alignSelf: 'flex-start',
          gap: 0.4,
          maxWidth: '100%',
          width: 'auto',
          boxSizing: 'border-box',
        }}
      >
        {(name || email || phone) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <PersonIcon sx={{ ...iconSm, color: 'primary.main', mt: '1px' }} />
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, fontSize: '0.78rem', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {name || 'Customer'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <Tooltip title="Text customer">
                <IconButton size="small" sx={{ p: 0.25 }} onClick={(e) => {
                  e.stopPropagation();
                  setCannedSmsOpen(true);
                }}>
                  <SmsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Share customer info by text">
                <IconButton size="small" sx={{ p: 0.25 }} onClick={(e) => {
                  e.stopPropagation();
                  setShareSmsRecipient('');
                  setShareMessage(buildJobShareMessage(j));
                  setShareDialogOpen(true);
                }}>
                  <ShareIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        )}
        {addressLine && (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
            <LocationIcon sx={{ ...iconSm, color: 'text.secondary', mt: '2px' }} />
            <Typography variant="caption" color="text.secondary" sx={smallText}>
              {addressLine}
            </Typography>
          </Box>
        )}
        {(email || phone) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
            {email && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <EmailIcon sx={{ ...iconSm, color: 'text.secondary' }} />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="a"
                  href={`mailto:${email}`}
                  sx={{ ...smallText, wordBreak: 'break-all', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                >
                  {email}
                </Typography>
              </Box>
            )}
            {phone && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PhoneIcon sx={{ ...iconSm, color: 'text.secondary' }} />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="a"
                  href={telHref(phone) || `tel:${phone.replace(/\s/g, '')}`}
                  sx={{ ...smallText, wordBreak: 'break-all', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                >
                  {formatPhoneForDisplay(phone)}
                </Typography>
              </Box>
            )}
          </Box>
        )}
        {gateCode ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <GateIcon sx={{ ...iconSm, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary" sx={smallText}>
              Gate code: {gateCode}
            </Typography>
          </Box>
        ) : null}
      </Box>
    );
  };

  if (!open) return null;
  const jobReady = Boolean(job && String(job._id) === String(jobId));
  const customerEntityId =
    jobReady && job?.customerId && typeof job.customerId === 'object'
      ? job.customerId?._id
      : jobReady
        ? job?.customerId || null
        : null;

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
        customerId: customerEntityId || undefined,
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

  const handleGenerateAiSummary = async () => {
    if (!jobId) return;
    setAiSummaryLoading(true);
    setAiSummaryText('');
    setAiSummaryMeta(null);
    try {
      const trimmed = aiSummaryPrompt.trim();
      const payload = { jobId };
      if (trimmed) payload.prompt = trimmed;

      const summaryUrls = [
        `${API_URL}/activities/summary`,
        `${API_URL}/activities/job/${jobId}/summary`,
        `${API_URL}/jobs/${jobId}/summary`,
      ];

      let res;
      let lastError;
      for (const url of summaryUrls) {
        try {
          res = await axios.post(url, payload);
          break;
        } catch (error) {
          lastError = error;
          if (error.response?.status !== 404) {
            throw error;
          }
        }
      }
      if (!res) {
        throw lastError;
      }

      setAiSummaryText(res.data.summary || '');
      setAiSummaryMeta({
        activityCount: res.data.activityCount,
        totalActivities: res.data.totalActivities,
        noteCount: res.data.noteCount,
        taskCount: res.data.taskCount,
        appointmentCount: res.data.appointmentCount,
        truncated: res.data.truncated,
        generatedAt: res.data.generatedAt,
      });
    } catch (error) {
      console.error('Job AI summary error:', error);
      const status = error.response?.status;
      if (status === 404) {
        toast.error(
          'Job summary API is not available yet. Redeploy the backend on Render with the latest code.'
        );
      } else if (status === 400 && !error.response?.data?.error) {
        toast.error('Job summary requires a backend update. Redeploy the backend, then try again.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to generate summary');
      }
      setAiSummaryOpen(false);
    } finally {
      setAiSummaryLoading(false);
    }
  };

  const handleOpenAiSummary = () => {
    setAiSummaryOpen(true);
    handleGenerateAiSummary();
  };

  if (!jobReady) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
        disableEnforceFocus={financialPin.dialogOpen}
        sx={sx}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            maxHeight: '90vh',
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 280,
            py: 6,
          }}
        >
          <CircularProgress />
        </Box>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      disableEnforceFocus={financialPin.dialogOpen}
      sx={sx}
      PaperProps={{
        sx: {
          borderRadius: '16px',
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          px: 2.5,
          pt: 1.25,
          pb: 1.5,
          ...(isEditing
            ? {
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(25, 118, 210, 0.08)'
                    : 'rgba(25, 118, 210, 0.04)',
              }
            : {}),
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            minHeight: 28,
          }}
        >
          {job._id != null && String(job._id).trim() !== '' ? (
            <Tooltip title={`Full job id: ${job._id}`} placement="bottom-start">
              <Typography
                variant="caption"
                component="span"
                sx={{
                  color: 'text.disabled',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.65rem',
                  letterSpacing: '0.04em',
                  userSelect: 'all',
                  cursor: 'default',
                }}
              >
                ID{' '}
                {String(job._id).length >= 8 ? String(job._id).slice(-8) : String(job._id)}
              </Typography>
            </Tooltip>
          ) : (
            <span />
          )}
          <IconButton onClick={onClose} size="small" title="Close" sx={{ mr: -0.75 }}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(150px, 1fr) minmax(0, auto) minmax(150px, 1fr)' },
            alignItems: 'start',
            columnGap: 2,
            rowGap: 1.5,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              minWidth: 0,
              order: { xs: 3, md: 1 },
            }}
          >
            {renderCustomerHeaderStrip(job)}
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              minWidth: 0,
              order: { xs: 1, md: 2 },
            }}
          >
            {isEditing ? (
              <Box sx={{ width: '100%', maxWidth: 420 }}>
                <TextField
                  fullWidth
                  value={editedJob?.title || ''}
                  onChange={(e) => handleFieldChange('title', e.target.value)}
                  variant="outlined"
                  size="small"
                  label="Job name"
                  autoFocus
                />
              </Box>
            ) : (
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, display: 'block', lineHeight: 1.25, letterSpacing: '-0.01em' }}
              >
                {job.title}
              </Typography>
            )}
            {!isEditing && job.description && (
              <Typography
                variant="body2"
                sx={{
                  mt: 0.25,
                  maxWidth: 480,
                  color: 'text.secondary',
                  fontStyle: 'italic',
                  fontWeight: 400,
                  display: 'block',
                  lineHeight: 1.4,
                }}
              >
                {job.description}
              </Typography>
            )}
            {isEditing ? (
              <Chip
                label="Editing job details"
                size="small"
                color="primary"
                variant="outlined"
                sx={{ mt: 1, fontWeight: 600 }}
              />
            ) : null}
          </Box>
          <Box
            sx={{
              order: { xs: 2, md: 3 },
              display: 'flex',
              justifyContent: { xs: 'flex-start', md: 'flex-end' },
              alignItems: 'flex-start',
              minWidth: 0,
            }}
          >
            {hideFinancials ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 32 }}>
                <Typography variant="caption" color="text.disabled">
                  Financials hidden
                </Typography>
                <Tooltip title="Unlock financial amounts">
                  <IconButton
                    size="small"
                    onClick={() => onRequestSensitiveUnlock?.()}
                    sx={{ color: 'text.secondary', p: 0.25 }}
                    aria-label="Unlock financial amounts"
                  >
                    <LockIcon sx={{ fontSize: '0.95rem' }} />
                  </IconButton>
                </Tooltip>
              </Box>
            ) : (
              <Box
                sx={{
                  width: '100%',
                  maxWidth: 264,
                  px: 1.25,
                  py: 1,
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: (theme) =>
                    theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'action.hover',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    fontSize: '0.62rem',
                    fontWeight: 600,
                  }}
                >
                  Job total
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    color: 'success.main',
                    fontWeight: 700,
                    lineHeight: 1.2,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCurrency(headerFullTotal)}
                </Typography>
                {isEditing && (
                  <TextField
                    type="text"
                    inputMode="decimal"
                    label="Base contract"
                    value={
                      editedJob?.valueEstimated === '' || editedJob?.valueEstimated == null
                        ? ''
                        : String(editedJob.valueEstimated)
                    }
                    onChange={(e) => {
                      const raw = sanitizeMoneyTypingInput(e.target.value);
                      handleFieldChange('valueEstimated', raw === '' ? '' : raw);
                    }}
                    variant="outlined"
                    size="small"
                    fullWidth
                    sx={{ mt: 1 }}
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 0.5 }}>$</Typography>,
                    }}
                  />
                )}
                <Divider sx={{ my: 0.75 }} />
                <HeaderMoneyRow label="Base contract" value={formatCurrency(headerContractBase)} />
                <HeaderMoneyRow label="Change orders" value={formatCurrency(headerChangeOrderValue)} />
                {headerPaymentSchedule.items.length > 0 && (
                  <>
                    <Divider sx={{ my: 0.75 }} />
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        mb: 0.25,
                        color: 'text.secondary',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        fontSize: '0.62rem',
                        fontWeight: 600,
                      }}
                    >
                      Payment schedule
                    </Typography>
                    {headerPaymentSchedule.items.map((item, idx) => (
                      <HeaderMoneyRow
                        key={`${item.label}-${idx}`}
                        label={
                          item.amountType === 'percentage' && Number.isFinite(Number(item.percentage))
                            ? `${item.label} (${item.percentage}%)`
                            : item.label
                        }
                        value={formatCurrency(item.amount)}
                        note={item.status === 'paid' ? '· Paid' : ''}
                      />
                    ))}
                  </>
                )}
              </Box>
            )}
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
            mt: 1.5,
            pt: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
          {!isShopDisplay ? (
            <>
              <Button
                size="small"
                variant="text"
                onClick={() => setCoverPagesOpen(true)}
                sx={HEADER_LINK_SX}
              >
                Cover page
              </Button>
              <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
              <Button
                size="small"
                variant="text"
                component={RouterLink}
                to={`/takeoff-sheet?jobId=${job._id}`}
                onClick={onClose}
                sx={HEADER_LINK_SX}
              >
                Takeoff
              </Button>
              <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
            </>
          ) : null}
          <Button
            size="small"
            variant="text"
            onClick={() => setActiveTab(JOB_MODAL_TAB.payments)}
            sx={HEADER_LINK_SX}
          >
            Edit Payments
          </Button>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 'auto' }}>
            {isEditing ? (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CancelIcon />}
                  onClick={handleCancel}
                  disabled={saving}
                  sx={{ textTransform: 'none' }}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                  onClick={handleSave}
                  disabled={saving}
                  sx={{ textTransform: 'none' }}
                >
                  Save
                </Button>
              </>
            ) : (
              <>
                <IconButton onClick={handleEdit} size="small" color="primary" title="Edit job">
                  <EditIcon fontSize="small" />
                </IconButton>
                {!job?.isArchived && !job?.isDeadEstimate && (
                  <IconButton onClick={handleArchive} size="small" color="warning" title="Archive" disabled={saving}>
                    <ArchiveIcon fontSize="small" />
                  </IconButton>
                )}
                {customerEntityId && (
                  <IconButton
                    component={RouterLink}
                    to={
                      isShopDisplay
                        ? shopDisplayCustomerPath(customerEntityId)
                        : `/customers?customerId=${customerEntityId}`
                    }
                    onClick={onClose}
                    size="small"
                    color="info"
                    title={isShopDisplay ? 'Open customer in shop view' : 'Open customer card'}
                  >
                    <PersonIcon fontSize="small" />
                  </IconButton>
                )}
                <IconButton onClick={handleDeleteClick} size="small" color="error" title="Delete job">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            )}
          </Box>
        </Box>
      </DialogTitle>

      <Box
        sx={{
          px: 2.5,
          borderTop: '1px solid',
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Tabs
          value={activeTab}
          onChange={(e, newValue) => setActiveTab(newValue)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 44,
            '& .MuiTab-root': {
              minHeight: 44,
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.875rem',
            },
          }}
        >
          <Tab label="Overview" />
          <Tab
            label={
              Number(job.unreadCustomerSmsCount) > 0
                ? `Messages (+${Number(job.unreadCustomerSmsCount)})`
                : 'Messages'
            }
          />
          <Tab label="Schedule" />
          <Tab label="Payments" />
          <Tab label="Files" />
          <Tab label="Notes" />
        </Tabs>
      </Box>

      <DialogContent sx={{ px: 2.5, py: 2.5 }}>
        {activeTab === 0 && (
          <Grid container spacing={2} alignItems="stretch">
            {jobNeedsMapFix(job) ? (
              <Grid item xs={12}>
                <Alert
                  severity="error"
                  action={
                    isEditing ? null : (
                      <Button color="inherit" size="small" onClick={handleEdit}>
                        Fix address
                      </Button>
                    )
                  }
                >
                  {jobMapFixLabel(job)}
                </Alert>
              </Grid>
            ) : null}
            {isEditing && (
              <Grid item xs={12}>
                <Paper
                  elevation={0}
                  sx={{
                    ...MODAL_CARD_SX,
                    borderColor: 'primary.main',
                    bgcolor: (theme) =>
                      theme.palette.mode === 'dark'
                        ? 'rgba(25, 118, 210, 0.08)'
                        : 'rgba(25, 118, 210, 0.04)',
                  }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
                    Job details
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        value={editedJob?.description || ''}
                        onChange={(e) => handleFieldChange('description', e.target.value)}
                        variant="outlined"
                        size="small"
                        label="Description"
                        multiline
                        minRows={2}
                        placeholder="Short note to help identify this job on the board"
                      />
                    </Grid>
                    <Grid item xs={12} id="job-site-address">
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
                        Job site address
                      </Typography>
                      <Grid container spacing={1.5}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Street"
                            value={editedJob?.jobAddress?.street || ''}
                            onChange={(e) => handleJobAddressFieldChange('street', e.target.value)}
                          />
                        </Grid>
                        <Grid item xs={12} sm={5}>
                          <TextField
                            fullWidth
                            size="small"
                            label="City"
                            value={editedJob?.jobAddress?.city || ''}
                            onChange={(e) => handleJobAddressFieldChange('city', e.target.value)}
                          />
                        </Grid>
                        <Grid item xs={6} sm={3}>
                          <TextField
                            fullWidth
                            size="small"
                            label="State"
                            value={editedJob?.jobAddress?.state || ''}
                            onChange={(e) => handleJobAddressFieldChange('state', e.target.value)}
                          />
                        </Grid>
                        <Grid item xs={6} sm={4}>
                          <TextField
                            fullWidth
                            size="small"
                            label="ZIP"
                            value={editedJob?.jobAddress?.zip || ''}
                            onChange={(e) => handleJobAddressFieldChange('zip', e.target.value)}
                          />
                        </Grid>
                        <Grid item xs={6} sm={6}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Latitude"
                            value={editedJob?.geo?.lat ?? ''}
                            onChange={(e) => handleGeoFieldChange('lat', e.target.value)}
                            placeholder="33.4581"
                          />
                        </Grid>
                        <Grid item xs={6} sm={6}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Longitude"
                            value={editedJob?.geo?.lng ?? ''}
                            onChange={(e) => handleGeoFieldChange('lng', e.target.value)}
                            placeholder="-117.6981"
                          />
                        </Grid>
                      </Grid>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Latitude and longitude are optional. Use them when the map cannot find the street.
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Source</InputLabel>
                        <Select
                          value={editedJob?.source || 'other'}
                          onChange={(e) => handleFieldChange('source', e.target.value)}
                          label="Source"
                        >
                          {JOB_SOURCE_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {editedJob?.source === 'referral' ? (
                        <Box sx={{ mt: 1.5 }}>
                          <ReferralCompanyField
                            size="small"
                            value={editedJob?.referralCompany || ''}
                            onChange={(referralCompany) => handleFieldChange('referralCompany', referralCompany)}
                          />
                        </Box>
                      ) : null}
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            )}

            {/* Recent Activity - First thing users see */}
            <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
              <Paper elevation={0} sx={MODAL_CARD_SX}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <DescriptionIcon sx={{ mr: 1, color: 'primary.main' }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      Recent Activity
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AutoAwesomeIcon />}
                    onClick={handleOpenAiSummary}
                    disabled={!jobId || aiSummaryLoading}
                    sx={{ textTransform: 'none', flexShrink: 0 }}
                  >
                    AI summary
                  </Button>
                </Box>

                {job.notes && job.notes.length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxHeight: 380, overflowY: 'auto' }}>
                    {[...job.notes]
                      .sort((a, b) => {
                        const dateA = new Date(a.createdAt || 0).getTime();
                        const dateB = new Date(b.createdAt || 0).getTime();
                        return dateB - dateA; // Descending order (newest first)
                      })
                      .slice(0, 10) // Show only last 10 activities
                      .map((note, index) => (
                        <Box 
                          key={index} 
                          sx={{ 
                            p: 1.5, 
                            borderRadius: 1, 
                            bgcolor: 'action.hover',
                            borderLeft: '3px solid',
                            borderColor: noteBorderColor(note)
                          }}
                        >
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              <Box component="span" sx={{ fontWeight: 700 }}>
                                [{getNoteAuthor(note)}]
                              </Box>
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatDateTime(note.createdAt)}
                            </Typography>
                          </Box>
                          <Typography 
                            variant="body2"
                            sx={{
                              color: noteTextColor(note),
                              fontStyle: (note.isStageChange || note.isAppointment || note.isSms) && !note.important ? 'italic' : 'normal',
                              fontWeight: note.important ? 600 : note.isStageChange || note.isSms ? 500 : 'normal'
                            }}
                          >
                            {renderTextWithLinks(note.content)}
                          </Typography>
                        </Box>
                      ))}
                    {job.notes.length > 10 && (
                      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', mt: 1 }}>
                        Showing 10 most recent. View all in Notes tab.
                      </Typography>
                    )}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <DescriptionIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
                    <Typography variant="body2" color="text.secondary">
                      No activity yet. View Notes tab to add notes or tasks.
                    </Typography>
                  </Box>
                )}
              </Paper>
            </Grid>

            <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
              <Paper elevation={0} sx={MODAL_CARD_SX}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <AssignmentIcon sx={{ mr: 1, color: 'primary.main' }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      Tasks
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Job Card #: {jobCardId}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {jobTasks.length} total
                    </Typography>
                  </Box>
                </Box>

                {jobTasks.length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxHeight: 380, overflowY: 'auto' }}>
                    {jobTasks
                      .slice()
                      .sort(
                        (a, b) =>
                          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
                      )
                      .map((task) => (
                        <Box
                          key={task._id}
                          sx={{
                            p: 1.5,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: 2,
                          }}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {task.title}
                            </Typography>
                            {task.description && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                {task.description}
                              </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                              {formatDateTime(task.createdAt)}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No tasks yet. Use Add Task to add as many as needed.
                  </Typography>
                )}
              </Paper>
            </Grid>

            {job.appointment?.dateTime && (
              <Grid item xs={12}>
                <Paper elevation={0} sx={MODAL_CARD_SX}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <CalendarIcon sx={{ mr: 1, color: 'primary.main' }} />
                    <Typography variant="subtitle2" color="text.secondary">
                      Appointment
                    </Typography>
                  </Box>
                  <Typography variant="body1" sx={{ mt: 1 }}>
                    {formatDateTime(job.appointment.dateTime)}
                  </Typography>
                  {job.appointment.location && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                      <LocationIcon sx={{ mr: 0.5, fontSize: '1rem', color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.appointment.location}
                      </Typography>
                    </Box>
                  )}
                  {job.appointment.notes && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {job.appointment.notes}
                    </Typography>
                  )}
                </Paper>
              </Grid>
            )}

            <Grid item xs={12}>
              <Paper elevation={0} sx={MODAL_CARD_SX}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Additional Information
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      Source
                    </Typography>
                    <Typography variant="body2">
                      {formatJobSourceWithCompany(job.source, job.referralCompany)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      Created
                    </Typography>
                    <Typography variant="body2">
                      {formatDate(job.createdAt)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      Last Updated
                    </Typography>
                    <Typography variant="body2">
                      {formatDate(job.updatedAt)}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        )}

        {activeTab === JOB_MODAL_TAB.schedule && (
          <Box>
            <JobSchedulePanel
              job={job}
              calendarPath={isShopDisplay ? shopDisplayCalendarPath() : '/calendar'}
            />
          </Box>
        )}

        {activeTab === JOB_MODAL_TAB.payments && (
          <Box>
            {hideFinancials ? (
              <Paper sx={{ p: 4, textAlign: 'center' }}>
                <Tooltip title="Unlock financial amounts">
                  <IconButton
                    onClick={() => onRequestSensitiveUnlock?.()}
                    aria-label="Unlock financial amounts"
                    sx={{ color: 'text.secondary' }}
                  >
                    <LockIcon sx={{ fontSize: 40 }} />
                  </IconButton>
                </Tooltip>
              </Paper>
            ) : (
              <>
                <JobPaymentsSummary job={job} />
                <JobPaymentScheduleEditor
                  job={job}
                  onSave={handleSavePaymentSchedule}
                  saving={scheduleSaving}
                />
                <JobChangeOrdersEditor
                  job={job}
                  onSave={handleSaveChangeOrders}
                  saving={changeOrdersSaving}
                />
              </>
            )}
          </Box>
        )}

        {activeTab === JOB_MODAL_TAB.files && (
          <Box
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            sx={{
              position: 'relative',
              minHeight: 280,
              borderRadius: 1,
              outline: dragActive ? '2px dashed' : 'none',
              outlineColor: 'primary.main',
              bgcolor: dragActive ? 'action.selected' : 'transparent',
            }}
          >
            {hideFinancials ? (
              <Paper sx={{ p: 4, textAlign: 'center' }}>
                <Tooltip title="Unlock financial amounts">
                  <IconButton
                    onClick={() => onRequestSensitiveUnlock?.()}
                    aria-label="Unlock financial amounts"
                    sx={{ color: 'text.secondary' }}
                  >
                    <LockIcon sx={{ fontSize: 40 }} />
                  </IconButton>
                </Tooltip>
              </Paper>
            ) : null}
            <>
            <input
              style={{ display: 'none' }}
              id="file-upload"
              type="file"
              multiple
              onChange={handleFileInputChange}
              disabled={uploading}
            />

            {files.length > 0 ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 1.5,
                  mb: 2,
                }}
              >
                {files.map((file) => {
                  const isImage = file.mimetype?.startsWith('image/');
                  const isPdf = file.mimetype === 'application/pdf';
                  const hoverDetails = [
                    `${formatFileSize(file.size)} • ${formatDate(file.createdAt)}`,
                    String(file.fileType || 'other').replace(/^\w/, (c) => c.toUpperCase()),
                  ].join('\n');

                  return (
                    <Tooltip
                      key={file._id}
                      title={
                        <Box sx={{ whiteSpace: 'pre-line' }}>
                          {hoverDetails}
                        </Box>
                      }
                      placement="top"
                      enterDelay={400}
                    >
                      <Paper
                        component={isImage ? 'a' : 'div'}
                        href={isImage ? `/picture/${file._id}` : undefined}
                        target={isImage ? '_blank' : undefined}
                        rel={isImage ? 'noopener noreferrer' : undefined}
                        onClick={isImage ? undefined : () => handleFileCardClick(file)}
                        sx={{
                          position: 'relative',
                          aspectRatio: '1',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          display: 'block',
                          color: 'inherit',
                          textDecoration: 'none',
                          border: '1px solid',
                          borderColor: 'divider',
                          bgcolor: 'action.hover',
                          '&:hover': {
                            boxShadow: 4,
                            borderColor: 'primary.main',
                            '& .file-tile-delete': { opacity: 1 },
                            '& .file-tile-open': { opacity: 1 },
                          },
                        }}
                      >
                        <Box sx={{ position: 'absolute', inset: 0, bottom: 28 }}>
                          {isImage ? (
                            <AuthenticatedFileImage
                              fileId={file._id}
                              alt=""
                              fill
                            />
                          ) : isPdf ? (
                            <Box
                              sx={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'hidden',
                              }}
                            >
                              <PdfThumbnail fileId={file._id} apiUrl={API_URL} maxWidth={160} maxHeight={132} fill />
                            </Box>
                          ) : (
                            <Box
                              sx={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <InsertDriveFileIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                            </Box>
                          )}
                        </Box>
                        <Box
                          sx={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            px: 1,
                            py: 0.5,
                            bgcolor: 'background.paper',
                            borderTop: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Typography
                            variant="caption"
                            noWrap
                            title={file.originalName}
                            sx={{ display: 'block', fontWeight: 600 }}
                          >
                            {file.originalName}
                          </Typography>
                        </Box>
                        {isImage ? (
                          <IconButton
                            className="file-tile-open"
                            size="small"
                            aria-label="Open picture in new tab"
                            title="Open in new tab"
                            sx={{
                              position: 'absolute',
                              top: 4,
                              left: 4,
                              opacity: 0,
                              bgcolor: 'background.paper',
                              boxShadow: 1,
                              pointerEvents: 'none',
                              '&:hover': { bgcolor: 'background.paper' },
                            }}
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        ) : null}
                        <IconButton
                          className="file-tile-delete"
                          size="small"
                          color="error"
                          aria-label="Delete file"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleFileDelete(file._id);
                          }}
                          sx={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            opacity: 0,
                            bgcolor: 'background.paper',
                            boxShadow: 1,
                            '&:hover': { bgcolor: 'background.paper' },
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Paper>
                    </Tooltip>
                  );
                })}
              </Box>
            ) : null}

            <Box
              onClick={() => {
                if (!uploading) document.getElementById('file-upload')?.click();
              }}
              sx={{
                mt: files.length ? 0 : 0,
                py: files.length ? 4 : 7,
                px: 2,
                minHeight: files.length ? 140 : 260,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                cursor: uploading ? 'default' : 'pointer',
                border: '2px dashed',
                borderColor: dragActive ? 'primary.main' : 'text.secondary',
                borderRadius: 2,
                bgcolor: dragActive ? 'action.selected' : (theme) =>
                  theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'grey.100',
              }}
            >
              <CloudUploadIcon
                sx={{
                  fontSize: files.length ? 40 : 56,
                  color: 'text.primary',
                  mb: 1.5,
                }}
              />
              <Typography variant="body1" sx={{ fontWeight: 600, mb: 0.75 }}>
                {uploading
                  ? 'Uploading…'
                  : dragActive
                    ? 'Drop files to upload'
                    : 'Drag & Drop your files here and start uploading'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Or simply click this box and select files manually
              </Typography>
            </Box>
            </>
          </Box>
        )}

        {activeTab === JOB_MODAL_TAB.notes && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<DescriptionIcon />}
                onClick={() => setAddNoteOpen(true)}
                sx={{ borderRadius: '8px', textTransform: 'none' }}
              >
                Add Note
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AssignmentIcon />}
                onClick={() => setAddTaskOpen(true)}
                sx={{ borderRadius: '8px', textTransform: 'none' }}
              >
                Add Task
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<CalendarIcon />}
                onClick={() => setAddAppointmentOpen(true)}
                sx={{ borderRadius: '8px', textTransform: 'none' }}
              >
                Add Appointment
              </Button>
            </Box>
            
            {job.notes && job.notes.length > 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[...job.notes]
                  .sort((a, b) => {
                    const dateA = new Date(a.createdAt || 0).getTime();
                    const dateB = new Date(b.createdAt || 0).getTime();
                    return dateB - dateA; // Descending order (newest first)
                  })
                  .map((note, index) => (
                    <Paper
                      key={index}
                      sx={{
                        p: 2,
                        borderLeft: '4px solid',
                        borderColor: noteBorderColor(note),
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          <Box component="span" sx={{ fontWeight: 700 }}>
                            [{getNoteAuthor(note)}]
                          </Box>{' '}
                          • {formatDateTime(note.createdAt)}
                        </Typography>
                      </Box>
                      <Typography 
                        variant="body2"
                        sx={{
                          color: noteTextColor(note),
                          fontStyle: (note.isStageChange || note.isAppointment || note.isSms) && !note.important ? 'italic' : 'normal',
                          fontWeight: note.important ? 600 : note.isStageChange || note.isSms ? 500 : 'normal'
                        }}
                      >
                        {renderTextWithLinks(note.content)}
                      </Typography>
                    </Paper>
                  ))}
              </Box>
            ) : (
              <Paper sx={{ p: 4, textAlign: 'center' }}>
                <DescriptionIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                <Typography variant="body1" color="text.secondary">
                  No notes yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Click "Add Note" or "Add Task" above to get started
                </Typography>
              </Paper>
            )}
          </Box>
        )}

        {activeTab === JOB_MODAL_TAB.messages && (
          <JobMessagesPanel
            job={job}
            refreshKey={messagesRefreshKey}
            onOpenCanned={() => setCannedSmsOpen(true)}
          />
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={handleDeleteCancel}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Delete Job</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>"{job?.title}"</strong>?
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            This action cannot be undone. All job data, estimates, and notes will be permanently deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Note Modal */}
      <AddNoteModal
        open={addNoteOpen}
        onClose={() => setAddNoteOpen(false)}
        onSuccess={(savedJob) => {
          applySavedJob(savedJob);
          onJobDataChanged({ type: 'note', jobId });
        }}
        job={job}
      />

      {/* Add Task Modal */}
      <AddJobTaskModal
        open={addTaskOpen}
        onClose={() => setAddTaskOpen(false)}
        onSuccess={() => {
          fetchJobDetails();
          onJobDataChanged({ type: 'task', jobId });
        }}
        job={job}
      />

      {/* Add Appointment Modal */}
      <AddAppointmentModal
        open={addAppointmentOpen}
        onClose={() => setAddAppointmentOpen(false)}
        onSuccess={() => {
          fetchJobDetails();
          onAppointmentCreated();
          onJobDataChanged({ type: 'appointment', jobId });
        }}
        job={job}
      />

      <JobCoverPagesDialog
        open={coverPagesOpen}
        onClose={() => setCoverPagesOpen(false)}
        job={job}
      />

      <JobCannedSmsDialog
        open={cannedSmsOpen}
        job={job}
        senderName={typeof user?.name === 'string' ? user.name : ''}
        companyName={
          user?.tenantId && typeof user.tenantId === 'object' && 'name' in user.tenantId && user.tenantId.name
            ? String(user.tenantId.name)
            : 'San Clemente Woodworking'
        }
        onClose={() => setCannedSmsOpen(false)}
        onSent={() => setMessagesRefreshKey((n) => n + 1)}
      />

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

      <Dialog
        open={aiSummaryOpen}
        onClose={() => {
          if (!aiSummaryLoading) setAiSummaryOpen(false);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>AI job summary</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Optional focus (e.g. scheduling, customer communication)"
            value={aiSummaryPrompt}
            onChange={(e) => setAiSummaryPrompt(e.target.value)}
            disabled={aiSummaryLoading}
            sx={{ mb: 2 }}
            helperText={`${aiSummaryPrompt.length}/1500`}
            inputProps={{ maxLength: 1500 }}
          />
          {aiSummaryMeta && !aiSummaryLoading && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Based on {aiSummaryMeta.noteCount ?? 0} note(s), {aiSummaryMeta.activityCount ?? 0} activity
              row(s)
              {aiSummaryMeta.truncated ? ' (activity list capped)' : ''}, {aiSummaryMeta.taskCount ?? 0}{' '}
              task(s), {aiSummaryMeta.appointmentCount ?? 0} appointment(s).
              {aiSummaryMeta.generatedAt
                ? ` Generated ${formatDateTime(aiSummaryMeta.generatedAt)}.`
                : null}
            </Typography>
          )}
          {aiSummaryLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4, justifyContent: 'center' }}>
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">
                Summarizing job history…
              </Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: '50vh', overflowY: 'auto' }}>{renderSummaryBlocks(aiSummaryText)}</Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (aiSummaryText) {
                navigator.clipboard.writeText(aiSummaryText);
                toast.success('Summary copied');
              }
            }}
            disabled={!aiSummaryText || aiSummaryLoading}
            startIcon={<ContentCopyIcon />}
          >
            Copy
          </Button>
          <Button onClick={handleGenerateAiSummary} disabled={aiSummaryLoading}>
            Refresh
          </Button>
          <Button onClick={() => setAiSummaryOpen(false)} disabled={aiSummaryLoading}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

export default JobDetailModal;

