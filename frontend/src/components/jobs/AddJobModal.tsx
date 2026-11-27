// @ts-nocheck — large modal; tighten types incrementally
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
  Box,
  CircularProgress,
  Autocomplete,
  Alert,
  InputAdornment,
  LinearProgress,
  Typography,
  IconButton,
  alpha,
} from '@mui/material';
import { Add as AddIcon, Close as CloseIcon, InsertDriveFile as FileIcon } from '@mui/icons-material';
import axios from 'axios';
import toast from 'react-hot-toast';
import PhoneTextField from '../common/PhoneTextField';
import { formatNanpTyping, formatPhoneForDisplay } from '../../utils/phoneFormat';
import { JOB_SOURCE_OPTIONS, sanitizeMoneyTypingInput, clipReferralCompany } from '../../utils/jobSources';
import ReferralCompanyField, { rememberReferralCompany } from '../common/ReferralCompanyField';
import { useWorksheetReading } from '../../hooks/useWorksheetReading';
import WorksheetReviewPanel, { VerifyChip } from './WorksheetReviewPanel';
import { customerDetailChanges, findCustomerMatches, isCompleteEmail } from '../../utils/customerChanges';
import { worksheetJobNote } from '../../utils/worksheetNote';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/** Synthetic "Create …" row from filterOptions — extract the typed name for submit state */
function parseCreateNewOptionName(option) {
  if (!option || option._id !== 'new' || typeof option.name !== 'string') return '';
  const m = /^Create "(.*)"$/.exec(option.name);
  return m ? m[1] : '';
}

const SOURCE_OPTIONS = JOB_SOURCE_OPTIONS;
const CREATE_JOB_FILE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const MAX_CREATE_JOB_FILES = 20;

function duplicatePlace(match) {
  return [match?.street, match?.city].filter(Boolean).join(', ');
}

function duplicateWarning(matches) {
  const first = matches?.[0] || {};
  const who = first.customerName || 'This customer';
  return `${who} at ${duplicatePlace(first)} already exists.`;
}

function validateCreateJobFile(file) {
  if (!CREATE_JOB_FILE_TYPES.includes(file.type)) return 'Only images and PDFs are allowed';
  if (file.size > 10 * 1024 * 1024) return 'File must be less than 10MB';
  return null;
}

function revokePendingPreviews(items) {
  (items || []).forEach((item) => {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
}

function AddJobModal({
  open,
  onClose,
  onJobCreated,
  pipelineLayoutId = null,
  initialStage = null,
  initialCustomerName = '',
  initialTitle = '',
  initialDescription = '',
  worksheetFile = null,
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    customerId: null,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerAddress: {
      street: '',
      city: '',
      state: '',
      zip: '',
    },
    valueEstimated: '',
    gateCode: '',
    source: 'other',
    referralCompany: '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [customers, setCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerInputValue, setCustomerInputValue] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [customerOnly, setCustomerOnly] = useState(false);
  const [verify, setVerify] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [updateSavedCustomer, setUpdateSavedCustomer] = useState(false);
  const [duplicateJobs, setDuplicateJobs] = useState([]);
  const [duplicatePrompt, setDuplicatePrompt] = useState(false);
  const duplicateRef = useRef({ key: '', matches: [], pending: null });
  const fileInputRef = useRef(null);
  const appliedReadingRef = useRef(null);
  const worksheet = useWorksheetReading(worksheetFile, open);
  const worksheetMode = Boolean(worksheetFile);
  const readingWorksheet = worksheetMode && worksheet.status === 'reading';

  useEffect(() => {
    if (!open) {
      setPendingFiles((prev) => {
        revokePendingPreviews(prev);
        return [];
      });
      setDuplicateJobs([]);
      setDuplicatePrompt(false);
      duplicateRef.current = { key: '', matches: [], pending: null };
      return;
    }
    const name = String(initialCustomerName || '').trim();
    const title = String(initialTitle || '').trim();
    const description = String(initialDescription || '').trim();
    setFormData({
      title,
      description,
      customerId: null,
      customerName: name,
      customerPhone: '',
      customerEmail: '',
      customerAddress: {
        street: '',
        city: '',
        state: '',
        zip: '',
      },
      valueEstimated: '',
      gateCode: '',
      source: 'other',
      referralCompany: '',
    });
    setErrors({});
    setCustomerOnly(false);
    setCustomerInputValue(name);
    setVerify({});
    setSuggestions({});
    setUpdateSavedCustomer(false);
    appliedReadingRef.current = null;
    setPendingFiles((prev) => {
      revokePendingPreviews(prev);
      if (!worksheetFile) return [];
      return [
        {
          file: worksheetFile,
          previewUrl: worksheetFile.type?.startsWith('image/') ? URL.createObjectURL(worksheetFile) : null,
        },
      ];
    });
    fetchCustomers().then((list) => {
      if (!name || !Array.isArray(list)) return;
      const match = list.find(
        (customer) => String(customer.name || '').trim().toLowerCase() === name.toLowerCase(),
      );
      if (!match) return;
      setFormData((prev) => ({
        ...prev,
        customerId: match._id,
        customerName: match.name,
        customerPhone: match.primaryPhone ? formatNanpTyping(match.primaryPhone) : '',
        customerEmail: match.primaryEmail || '',
        customerAddress: match.address || {
          street: '',
          city: '',
          state: '',
          zip: '',
        },
      }));
      setCustomerInputValue(match.name);
    });
  }, [open, initialCustomerName, initialDescription, initialTitle, worksheetFile]);

  useEffect(() => {
    if (!open || worksheet.status !== 'done' || !worksheet.reading) return;
    if (appliedReadingRef.current === worksheet.reading) return;
    appliedReadingRef.current = worksheet.reading;
    const draft = worksheet.reading.draft || {};
    const source = SOURCE_OPTIONS.some((option) => option.value === draft.source) ? draft.source : 'other';
    const name = String(draft.customerName || '').trim();
    setFormData((prev) => ({
      ...prev,
      title: String(draft.title || '').trim() || prev.title,
      customerId: null,
      customerName: name,
      customerPhone: draft.customerPhone ? formatNanpTyping(draft.customerPhone) : '',
      customerEmail: String(draft.customerEmail || '').trim(),
      customerAddress: {
        street: String(draft.street || '').trim(),
        city: String(draft.city || '').trim(),
        state: String(draft.state || '').trim(),
        zip: String(draft.zip || '').trim(),
      },
      valueEstimated: draft.valueEstimated ? String(draft.valueEstimated) : '',
      gateCode: String(draft.gateCode || '').trim(),
      source,
      referralCompany: source === 'referral' ? clipReferralCompany(draft.referralCompany) : '',
    }));
    setCustomerInputValue(name);
    setVerify(worksheet.reading.verify || {});
    setSuggestions(worksheet.reading.suggestions || {});
    setErrors({});
  }, [open, worksheet.status, worksheet.reading]);

  const savedCustomer = useMemo(() => {
    if (formData.customerId) return customers.find((customer) => customer._id === formData.customerId) || null;
    const name = formData.customerName.trim().toLowerCase();
    if (!name) return null;
    return customers.find((customer) => String(customer.name || '').trim().toLowerCase() === name) || null;
  }, [customers, formData.customerId, formData.customerName]);

  const customerChanges = useMemo(
    () => customerDetailChanges(savedCustomer, formData),
    [savedCustomer, formData],
  );

  const customerMatches = useMemo(() => {
    if (!worksheetMode || worksheet.status !== 'done' || savedCustomer) return [];
    return findCustomerMatches(customers, formData, suggestions.customerEmail);
  }, [worksheetMode, worksheet.status, savedCustomer, customers, formData, suggestions.customerEmail]);

  useEffect(() => {
    setUpdateSavedCustomer(false);
  }, [savedCustomer?._id]);

  const duplicateKey = [
    formData.customerName.trim(),
    formData.customerAddress.street.trim(),
    formData.customerAddress.city.trim(),
  ]
    .join('\n')
    .toLowerCase();

  const loadDuplicates = useCallback(async () => {
    const [name, street, city] = duplicateKey.split('\n');
    if (!name || !street) {
      duplicateRef.current = { key: duplicateKey, matches: [], pending: null };
      setDuplicateJobs((current) => (current.length ? [] : current));
      return [];
    }
    const cached = duplicateRef.current;
    if (cached.key === duplicateKey && cached.pending) return cached.pending;
    if (cached.key === duplicateKey) return cached.matches;
    const pending = axios
      .get(`${API_URL}/jobs/possible-duplicates`, { params: { name, street, city } })
      .then((response) => (Array.isArray(response.data?.matches) ? response.data.matches : []))
      .catch(() => []);
    duplicateRef.current = { key: duplicateKey, matches: [], pending };
    const matches = await pending;
    if (duplicateRef.current.pending === pending) {
      duplicateRef.current = { key: duplicateKey, matches, pending: null };
      setDuplicateJobs(matches);
    }
    return matches;
  }, [duplicateKey]);

  useEffect(() => {
    if (!open || customerOnly) {
      setDuplicateJobs((current) => (current.length ? [] : current));
      setDuplicatePrompt(false);
      return undefined;
    }
    const [name, street] = duplicateKey.split('\n');
    if (!name || !street) {
      setDuplicateJobs((current) => (current.length ? [] : current));
      setDuplicatePrompt(false);
      return undefined;
    }
    setDuplicatePrompt(false);
    let cancelled = false;
    const timer = setTimeout(() => {
      loadDuplicates().then((matches) => {
        if (!cancelled) setDuplicateJobs(matches);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, customerOnly, duplicateKey, loadDuplicates]);

  const clearVerify = (field) => {
    setVerify((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const verifyAdornment = (field) =>
    verify[field] ? (
      <InputAdornment position="end">
        <VerifyChip reason={verify[field]} onClick={() => clearVerify(field)} />
      </InputAdornment>
    ) : null;

  const fieldHelp = (field, fallback = undefined) => errors[field] || verify[field] || fallback;

  const chooseExistingCustomer = (customer) => {
    setFormData((prev) => ({
      ...prev,
      customerId: customer._id,
      customerName: customer.name,
      customerPhone: prev.customerPhone || (customer.primaryPhone ? formatNanpTyping(customer.primaryPhone) : ''),
      customerEmail: prev.customerEmail || customer.primaryEmail || '',
      customerAddress: {
        street: prev.customerAddress.street || customer.address?.street || '',
        city: prev.customerAddress.city || customer.address?.city || '',
        state: prev.customerAddress.state || customer.address?.state || '',
        zip: prev.customerAddress.zip || customer.address?.zip || '',
      },
    }));
    setCustomerInputValue(customer.name);
    clearVerify('customerName');
  };

  const fetchCustomers = async () => {
    try {
      setLoadingCustomers(true);
      const response = await axios.get(`${API_URL}/customers?limit=1000`);
      const list = response.data.customers || response.data || [];
      setCustomers(list);
      return list;
    } catch (error) {
      console.error('Error fetching customers:', error);
      return [];
    } finally {
      setLoadingCustomers(false);
    }
  };

  const handleCustomerChange = (event, newValue, reason) => {
    if (reason === 'selectOption' && newValue) {
      if (newValue._id === 'new') {
        const typedName = parseCreateNewOptionName(newValue);
        setFormData((prev) => ({
          ...prev,
          customerId: null,
          customerName: typedName || prev.customerName,
          customerPhone: '',
          customerEmail: '',
          customerAddress: {
            street: '',
            city: '',
            state: '',
            zip: '',
          },
        }));
        if (typedName) {
          setCustomerInputValue(typedName);
        }
      } else if (worksheetMode) {
        chooseExistingCustomer(newValue);
      } else {
        setFormData((prev) => ({
          ...prev,
          customerId: newValue._id,
          customerName: newValue.name,
          customerPhone: newValue.primaryPhone ? formatNanpTyping(newValue.primaryPhone) : '',
          customerEmail: newValue.primaryEmail || '',
          customerAddress: newValue.address || {
            street: '',
            city: '',
            state: '',
            zip: '',
          },
        }));
        setCustomerInputValue(newValue.name);
      }
    } else if (reason === 'clear') {
      setFormData((prev) => ({
        ...prev,
        customerId: null,
        customerName: '',
        customerPhone: '',
        customerEmail: '',
        customerAddress: {
          street: '',
          city: '',
          state: '',
          zip: '',
        },
      }));
      setCustomerInputValue('');
    }
  };

  const handleCustomerInputChange = (event, newInputValue, reason) => {
    // Do not skip `reset`: MUI may emit reset when clearing; ignoring it blocks empty input.
    setCustomerInputValue(newInputValue);
    if (reason === 'input') clearVerify('customerName');

    if (newInputValue === '') {
      setFormData((prev) => ({
        ...prev,
        customerId: null,
        customerName: '',
      }));
      return;
    }

    // Always mirror typed text into customerName. Previously we skipped when the text matched an
    // existing customer exactly — that left stale customerName and broke backspace/delete.
    // Keep customerId only while the typed string still matches the selected customer.
    setFormData((prev) => {
      const selected = prev.customerId
        ? customers.find((c) => c._id === prev.customerId)
        : null;
      const stillMatchesSelection =
        selected &&
        selected.name.toLowerCase() === newInputValue.toLowerCase();

      return {
        ...prev,
        customerName: newInputValue,
        customerId: stillMatchesSelection ? prev.customerId : null,
      };
    });
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    clearVerify(field);
    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleAddressChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      customerAddress: {
        ...prev.customerAddress,
        [field]: value,
      },
    }));
    clearVerify(field);
  };

  const validate = () => {
    const newErrors = {};
    if (!customerOnly && !formData.title.trim()) {
      newErrors.title = 'Job title is required';
    }
    if (!formData.customerName.trim() && !formData.customerId) {
      newErrors.customerName = 'Customer name is required';
    }
    if (formData.customerEmail.trim() && !isCompleteEmail(formData.customerEmail)) {
      newErrors.customerEmail = 'This email looks incomplete. Fix it or clear it.';
    }
    if (formData.valueEstimated && isNaN(formData.valueEstimated)) {
      newErrors.valueEstimated = 'Estimated value must be a number';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const addPendingFiles = (fileList) => {
    const incoming = [...(fileList || [])].filter(Boolean);
    if (!incoming.length) return;

    const skipped = [];
    const valid = [];
    for (const file of incoming) {
      const reason = validateCreateJobFile(file);
      if (reason) skipped.push({ name: file.name, reason });
      else valid.push(file);
    }
    if (skipped.length) {
      const first = skipped[0];
      const more = skipped.length > 1 ? ` (+${skipped.length - 1} more skipped)` : '';
      toast.error(`${first.name}: ${first.reason}${more}`);
    }
    if (!valid.length) return;

    setPendingFiles((prev) => {
      const remaining = Math.max(0, MAX_CREATE_JOB_FILES - prev.length);
      if (remaining === 0) {
        toast.error(`You can attach up to ${MAX_CREATE_JOB_FILES} files`);
        return prev;
      }
      const existing = new Set(prev.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
      const nextItems = [];
      for (const file of valid) {
        if (nextItems.length >= remaining) break;
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (existing.has(key)) continue;
        existing.add(key);
        nextItems.push({
          file,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        });
      }
      if (valid.length > remaining) {
        toast.error(`You can attach up to ${MAX_CREATE_JOB_FILES} files`);
      }
      return nextItems.length ? [...prev, ...nextItems] : prev;
    });
  };

  const removePendingFile = (index) => {
    setPendingFiles((prev) => {
      const item = prev[index];
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadPendingFiles = async (jobId) => {
    const filesToUpload = pendingFiles;
    if (!filesToUpload.length) return { succeeded: 0, failed: 0 };
    let succeeded = 0;
    let failed = 0;
    for (const item of filesToUpload) {
      try {
        const uploadData = new FormData();
        uploadData.append('file', item.file);
        uploadData.append('jobId', jobId);
        uploadData.append('fileType', item.file.type.startsWith('image/') ? 'photo' : 'other');
        await axios.post(`${API_URL}/files/upload`, uploadData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        console.error('Error uploading file:', item.file.name, error);
      }
    }
    return { succeeded, failed };
  };

  const handleSubmit = async (_event, options = {}) => {
    if (!validate()) {
      return;
    }

    if (!customerOnly && !options.confirmedDuplicate) {
      const matches = await loadDuplicates();
      if (matches.length) {
        setDuplicateJobs(matches);
        setDuplicatePrompt(true);
        return;
      }
    }

    try {
      setSaving(true);
      
      // Use existing customer ID if selected, otherwise find or create
      let customerId = formData.customerId;
      const customerName = formData.customerName.trim();
      
      const gateCode = String(formData.gateCode || '').trim();
      try {
        const updateData = {};
        if (savedCustomer && updateSavedCustomer && customerChanges.length) {
          customerChanges.forEach((change) => {
            updateData[change.key] = change.value;
          });
        }
        if (savedCustomer && gateCode && !String(savedCustomer.gateCode || '').trim()) {
          updateData.gateCode = gateCode;
        }
        if (Object.keys(updateData).length) {
          await axios.patch(`${API_URL}/customers/${savedCustomer._id}`, updateData);
        }
      } catch (customerError) {
        console.error('Error updating customer:', customerError);
        toast.error(customerError.response?.data?.error || 'Could not update the saved customer');
        return;
      }

      if (!customerId) {
        // Need to find or create customer
        try {
          const existingCustomer = savedCustomer;

          if (existingCustomer) {
            customerId = existingCustomer._id;
          } else {
            // Create new customer with all provided information
            const customerResponse = await axios.post(`${API_URL}/customers`, {
              name: customerName,
              primaryPhone: formData.customerPhone || undefined,
              primaryEmail: formData.customerEmail || undefined,
              address: (formData.customerAddress.street || formData.customerAddress.city) 
                ? formData.customerAddress 
                : undefined,
              source: formData.source,
              gateCode: gateCode || undefined,
              referralCompany: formData.source === 'referral' ? clipReferralCompany(formData.referralCompany) : '',
              // Pipeline flow creates the real job next; avoid duplicate "Name — Job" from API
              skipInitialJob: true,
            });
            customerId = customerResponse.data._id;
          }
        } catch (customerError) {
          console.error('Error finding/creating customer:', customerError);
          if (customerError.response?.data?.error) {
            toast.error(`Customer error: ${customerError.response.data.error}`);
          } else {
            toast.error('Failed to find or create customer');
          }
          return;
        }
      }

      if (customerOnly) {
        if (pendingFiles.length) {
          toast('Customer saved. Files stay with a job, so they were not uploaded.');
        } else {
          toast.success('Customer saved. No job was added to the pipeline.');
        }
        onClose();
        return;
      }
      
      // Create the job
      const worksheetNote = worksheetJobNote(worksheet.reading?.review, gateCode);
      const jobData = {
        title: formData.title.trim(),
        description: formData.description.trim() || '',
        customerId: customerId,
        stage: (initialStage && String(initialStage).trim()) || 'ESTIMATE_IN_PROGRESS',
        source: formData.source,
        referralCompany: formData.source === 'referral' ? clipReferralCompany(formData.referralCompany) : '',
      };
      if (worksheetNote) jobData.notes = [{ content: worksheetNote, isWorksheet: true }];
      if (pipelineLayoutId) {
        jobData.pipelineLayoutId = pipelineLayoutId;
      }

      // Only include valueEstimated if it's provided and valid
      if (formData.valueEstimated && !isNaN(formData.valueEstimated)) {
        jobData.valueEstimated = parseFloat(formData.valueEstimated);
      }

      // Store job-specific address if provided (for contractors with multiple job sites)
      if (formData.customerAddress.street || formData.customerAddress.city || 
          formData.customerAddress.state || formData.customerAddress.zip) {
        jobData.jobAddress = {
          street: formData.customerAddress.street || undefined,
          city: formData.customerAddress.city || undefined,
          state: formData.customerAddress.state || undefined,
          zip: formData.customerAddress.zip || undefined,
        };
      }

      // Store job-specific contact if different from customer
      if (formData.customerPhone || formData.customerEmail) {
        jobData.jobContact = {
          phone: formData.customerPhone || undefined,
          email: formData.customerEmail || undefined,
        };
      }

      const response = await axios.post(`${API_URL}/jobs`, jobData);
      if (jobData.source === 'referral' && jobData.referralCompany) {
        rememberReferralCompany(jobData.referralCompany);
      }

      const jobId = response.data?._id;
      let uploadResult = { succeeded: 0, failed: 0 };
      if (jobId && pendingFiles.length) {
        uploadResult = await uploadPendingFiles(jobId);
      }

      const createdJob = response.data;
      const lat = Number(createdJob?.geo?.lat);
      const lng = Number(createdJob?.geo?.lng);
      const onMap =
        createdJob?.geo?.status === 'ok' && Number.isFinite(lat) && Number.isFinite(lng);
      const hasAddress = Boolean(
        formData.customerAddress.street ||
          formData.customerAddress.city ||
          formData.customerAddress.state ||
          formData.customerAddress.zip,
      );

      if (!onMap) {
        toast.error(
          hasAddress
            ? "Couldn't place this job on the map. Click the error on the job card to correct the address."
            : 'Job created. Add a street address so it can be placed on the map.',
          { duration: 7000 },
        );
      } else if (uploadResult.failed && uploadResult.succeeded) {
        toast.error(`Job created, but ${uploadResult.failed} file${uploadResult.failed === 1 ? '' : 's'} failed to upload`);
      } else if (uploadResult.failed) {
        toast.error('Job created, but files failed to upload. Add them from the Files tab.');
      } else if (uploadResult.succeeded) {
        toast.success(
          uploadResult.succeeded === 1
            ? 'Job created with 1 file'
            : `Job created with ${uploadResult.succeeded} files`,
        );
      } else {
        toast.success('Job created successfully');
      }
      
      if (onJobCreated) {
        onJobCreated(response.data);
      }
      
      onClose();
    } catch (error) {
      console.error('Error creating job:', error);
      if (error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else {
        toast.error('Failed to create job');
      }
    } finally {
      setSaving(false);
    }
  };

  const verifyCount = Object.keys(verify).length;
  const emailSuggestion =
    suggestions.customerEmail && suggestions.customerEmail !== formData.customerEmail.trim().toLowerCase()
      ? suggestions.customerEmail
      : '';
  const emailMessage = errors.customerEmail || verify.customerEmail;

  return (
    <>
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth={worksheetMode ? 'lg' : 'sm'} fullWidth>
      <DialogTitle>{customerOnly ? 'Save customer' : 'Create New Job'}</DialogTitle>
      {readingWorksheet ? <LinearProgress aria-label="Reading the worksheet" /> : null}
      <DialogContent
        sx={
          worksheetMode
            ? {
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
                gap: 3,
                alignItems: 'start',
              }
            : undefined
        }
      >
        {worksheetMode ? (
          <WorksheetReviewPanel
            key={`${worksheetFile.name}:${worksheetFile.size}:${worksheetFile.lastModified}`}
            file={worksheetFile}
            status={worksheet.status}
            previewUrl={worksheet.previewUrl}
            reading={worksheet.reading}
            similarText={worksheetJobNote(worksheet.reading?.review, formData.gateCode)}
          />
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2, position: 'relative', minWidth: 0 }}>
          {readingWorksheet ? (
            <Box
              role="status"
              sx={{
                position: 'absolute',
                inset: 0,
                zIndex: 2,
                bgcolor: (theme) => alpha(theme.palette.background.paper, 0.82),
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                pt: 10,
                gap: 1.25,
                textAlign: 'center',
              }}
            >
              <CircularProgress size={30} />
              <Typography sx={{ fontWeight: 600 }}>Reading the worksheet…</Typography>
              <Typography variant="body2" color="text.secondary">
                Handwriting takes about 15 seconds.
              </Typography>
              <Button size="small" onClick={worksheet.skip} sx={{ textTransform: 'none' }}>
                Enter it by hand
              </Button>
            </Box>
          ) : null}
          {worksheetMode && worksheet.status === 'done' ? (
            <Alert severity={verifyCount ? 'warning' : 'success'}>
              Filled from the worksheet.{' '}
              {verifyCount
                ? `Check the ${verifyCount === 1 ? 'field' : `${verifyCount} fields`} marked Verify, then click Create Job.`
                : 'Check the details, then click Create Job.'}
            </Alert>
          ) : null}
          {worksheetMode && worksheet.status === 'failed' ? (
            <Alert severity="error">
              {worksheet.error}. Enter the job by hand. The worksheet is still attached.
            </Alert>
          ) : null}
          {worksheetMode && worksheet.status === 'skipped' ? (
            <Alert severity="info">Reading stopped. Enter the job by hand. The worksheet is still attached.</Alert>
          ) : null}
          <TextField
            label="Job Title"
            value={formData.title}
            onChange={(e) => handleChange('title', e.target.value)}
            required={!customerOnly}
            disabled={customerOnly}
            error={!!errors.title}
            helperText={customerOnly ? 'No pipeline job will be created' : fieldHelp('title')}
            fullWidth
            autoFocus={!worksheetMode}
            InputProps={{ endAdornment: verifyAdornment('title') }}
          />

          <TextField
            label="Description"
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
            fullWidth
            multiline
            rows={2}
            placeholder="Add a short description to help identify this job..."
          />

          <Autocomplete
            freeSolo
            selectOnFocus={false}
            autoHighlight={false}
            options={customers}
            isOptionEqualToValue={(option, value) => {
              if (option === value) return true;
              if (!option || !value) return false;
              return String(option._id) === String(value._id);
            }}
            getOptionLabel={(option) => {
              if (typeof option === 'string') return option;
              if (option._id === 'new') return option.name;
              return option.name || '';
            }}
            value={formData.customerId ? customers.find(c => c._id === formData.customerId) || null : null}
            inputValue={customerInputValue}
            onInputChange={handleCustomerInputChange}
            onChange={handleCustomerChange}
            loading={loadingCustomers}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Customer Name"
                required
                error={!!errors.customerName}
                helperText={fieldHelp('customerName', 'Select existing customer or type to create new')}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {verify.customerName ? (
                        <VerifyChip reason={verify.customerName} onClick={() => clearVerify('customerName')} />
                      ) : null}
                      {loadingCustomers ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              if (option._id === 'new') {
                return (
                  <Box component="li" {...props} key="new" sx={{ fontStyle: 'italic', color: 'primary.main' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AddIcon fontSize="small" />
                      <Typography variant="body1">{option.name}</Typography>
                    </Box>
                  </Box>
                );
              }
              return (
                <Box component="li" {...props} key={option._id}>
                  <Box>
                    <Typography variant="body1">{option.name}</Typography>
                    {(option.primaryPhone || option.primaryEmail) && (
                      <Typography variant="caption" color="text.secondary">
                        {[option.primaryPhone ? formatPhoneForDisplay(option.primaryPhone) : '', option.primaryEmail]
                          .filter(Boolean)
                          .join(' • ')}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            }}
            filterOptions={(options, params) => {
              const filtered = options.filter((option) =>
                option.name.toLowerCase().includes(params.inputValue.toLowerCase())
              );
              
              // If input doesn't match any option exactly, show "Create new" option
              if (params.inputValue !== '' && !options.some(opt => opt.name.toLowerCase() === params.inputValue.toLowerCase())) {
                return [{ _id: 'new', name: `Create "${params.inputValue}"` }, ...filtered];
              }
              
              return filtered;
            }}
          />

          {customerMatches.length ? (
            <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                This may be a saved customer
              </Typography>
              {customerMatches.map(({ customer, reasons }) => (
                <Box
                  key={customer._id}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
                >
                  <Typography variant="body2">
                    {[customer.name, customer.primaryPhone ? formatPhoneForDisplay(customer.primaryPhone) : '', customer.primaryEmail]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      (same {reasons.join(' and ')})
                    </Box>
                  </Typography>
                  <Button size="small" onClick={() => chooseExistingCustomer(customer)} sx={{ textTransform: 'none' }}>
                    Use this customer
                  </Button>
                </Box>
              ))}
            </Alert>
          ) : null}

          <Box sx={{ display: 'flex', gap: 2 }}>
            <PhoneTextField
              label="Phone"
              value={formData.customerPhone}
              onChange={(e) => handleChange('customerPhone', e.target.value)}
              fullWidth
              placeholder="(949) 555-1234"
              helperText={fieldHelp('customerPhone')}
              InputProps={{ endAdornment: verifyAdornment('customerPhone') }}
            />
            <TextField
              label="Email"
              value={formData.customerEmail}
              onChange={(e) => handleChange('customerEmail', e.target.value)}
              type="email"
              fullWidth
              placeholder="customer@example.com"
              error={!!errors.customerEmail}
              helperText={
                emailMessage || emailSuggestion ? (
                  <>
                    {emailMessage}
                    {emailSuggestion ? (
                      <Button
                        size="small"
                        onClick={() => handleChange('customerEmail', emailSuggestion)}
                        sx={{ p: 0, ml: emailMessage ? 0.75 : 0, minWidth: 0, textTransform: 'none', verticalAlign: 'baseline' }}
                      >
                        Use {emailSuggestion}
                      </Button>
                    ) : null}
                  </>
                ) : undefined
              }
              InputProps={{ endAdornment: verifyAdornment('customerEmail') }}
            />
          </Box>

          <TextField
            label="Street Address"
            value={formData.customerAddress.street}
            onChange={(e) => handleAddressChange('street', e.target.value)}
            fullWidth
            placeholder="123 Main St"
            helperText={fieldHelp('street')}
            InputProps={{ endAdornment: verifyAdornment('street') }}
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="City"
              value={formData.customerAddress.city}
              onChange={(e) => handleAddressChange('city', e.target.value)}
              sx={{ flex: 1 }}
              placeholder="San Clemente"
              fullWidth
              helperText={fieldHelp('city')}
              InputProps={{ endAdornment: verifyAdornment('city') }}
            />
            <TextField
              label="State"
              value={formData.customerAddress.state}
              onChange={(e) => handleAddressChange('state', e.target.value)}
              sx={{ width: 100 }}
              placeholder="CA"
              helperText={fieldHelp('state')}
              InputProps={{ endAdornment: verifyAdornment('state') }}
            />
            <TextField
              label="ZIP"
              value={formData.customerAddress.zip}
              onChange={(e) => handleAddressChange('zip', e.target.value)}
              sx={{ width: 120 }}
              placeholder="92672"
              helperText={fieldHelp('zip')}
              InputProps={{ endAdornment: verifyAdornment('zip') }}
            />
          </Box>

          {worksheetMode ? (
            <TextField
              label="Gate code"
              value={formData.gateCode}
              onChange={(e) => handleChange('gateCode', e.target.value)}
              fullWidth
              placeholder="Optional"
              helperText={fieldHelp('gateCode', 'Saved on the customer, and in the job note with the other worksheet details')}
              InputProps={{ endAdornment: verifyAdornment('gateCode') }}
            />
          ) : null}

          {savedCustomer && customerChanges.length ? (
            <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'warning.main', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                This differs from {savedCustomer.name}&apos;s saved details
              </Typography>
              {customerChanges.map((change) => (
                <Typography key={change.key} variant="body2" color="text.secondary">
                  {change.label}: saved {change.from || 'blank'}, new {change.to}
                </Typography>
              ))}
              <FormControlLabel
                sx={{ mt: 0.5 }}
                control={
                  <Checkbox
                    checked={updateSavedCustomer}
                    onChange={(e) => setUpdateSavedCustomer(e.target.checked)}
                    disabled={saving}
                  />
                }
                label={`Update ${savedCustomer.name}'s saved customer details`}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {updateSavedCustomer
                  ? `${savedCustomer.name}'s record changes when you click ${customerOnly ? 'Save customer' : 'Create Job'}.`
                  : customerOnly
                    ? 'Left unchecked, the saved customer stays as it is.'
                    : 'Left unchecked, these details are saved on this job only.'}
              </Typography>
            </Box>
          ) : null}

          <TextField
            label="Estimated Value"
            type="text"
            inputMode="decimal"
            value={formData.valueEstimated}
            onChange={(e) => handleChange('valueEstimated', sanitizeMoneyTypingInput(e.target.value))}
            error={!!errors.valueEstimated}
            helperText={fieldHelp('valueEstimated', 'Optional')}
            fullWidth
            placeholder="0.00"
            slotProps={{
              input: {
                endAdornment: verifyAdornment('valueEstimated'),
                sx: {
                  MozAppearance: 'textfield',
                  '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': {
                    WebkitAppearance: 'none',
                    margin: 0,
                  },
                },
              },
            }}
          />

          <FormControl fullWidth>
            <InputLabel>Source</InputLabel>
            <Select
              value={formData.source}
              onChange={(e) => {
                const source = e.target.value;
                setFormData((prev) => ({
                  ...prev,
                  source,
                  referralCompany: source === 'referral' ? prev.referralCompany : '',
                }));
              }}
              label="Source"
            >
              {SOURCE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {formData.source === 'referral' ? (
            <ReferralCompanyField
              value={formData.referralCompany}
              onChange={(referralCompany) => handleChange('referralCompany', referralCompany)}
            />
          ) : null}

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 600 }}>
              Photos & files
            </Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
              multiple
              hidden
              onChange={(e) => {
                addPendingFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <Box
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (saving) return;
                addPendingFiles(e.dataTransfer.files);
              }}
              sx={{
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 1,
                px: 1.5,
                py: 1.25,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                flexWrap: 'wrap',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                Browse or drop photos here
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
                sx={{ textTransform: 'none' }}
              >
                Browse
              </Button>
            </Box>
            {pendingFiles.length > 0 ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {pendingFiles.map((item, index) => (
                  <Box
                    key={`${item.file.name}-${item.file.lastModified}-${index}`}
                    sx={{
                      position: 'relative',
                      width: 72,
                      height: 72,
                      borderRadius: 1,
                      overflow: 'hidden',
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'action.hover',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {item.previewUrl ? (
                      <Box
                        component="img"
                        src={item.previewUrl}
                        alt={item.file.name}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <FileIcon fontSize="small" color="action" />
                    )}
                    <IconButton
                      size="small"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => removePendingFile(index)}
                      disabled={saving}
                      sx={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        width: 20,
                        height: 20,
                        bgcolor: 'rgba(0,0,0,0.55)',
                        color: '#fff',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                      }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>

          <FormControlLabel
            control={
              <Checkbox
                checked={customerOnly}
                onChange={(e) => setCustomerOnly(e.target.checked)}
                disabled={saving}
              />
            }
            label="Save the customer only — don't add a pipeline job"
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            Use this for a contractor or company. Their address stays on the customer. A project address can be added later when you create the job.
          </Typography>

          {!customerOnly && duplicateJobs.length ? (
            <Alert severity="warning">
              <Box sx={{ fontWeight: 700 }}>{duplicateWarning(duplicateJobs)}</Box>
              <Box component="ul" sx={{ my: 0.5, mb: 0, pl: 2.5 }}>
                {duplicateJobs.map((job) => (
                  <li key={job.id || job.title}>
                    {job.title} — {job.stateLabel}
                  </li>
                ))}
              </Box>
            </Alert>
          ) : null}

          {!customerOnly ? (
          <Box sx={{ mt: 1, p: 1.5, bgcolor: 'info.light', borderRadius: 1 }}>
            <Box sx={{ fontSize: '0.875rem', color: 'info.dark' }}>
              <strong>Note:</strong> New jobs will be created in the <strong>Estimate Current, first 5 days</strong> stage.
            </Box>
          </Box>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={saving || readingWorksheet}
        >
          {saving ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
          {saving && pendingFiles.length && !customerOnly
            ? 'Uploading…'
            : saving
              ? 'Saving…'
              : customerOnly
                ? 'Save customer'
                : 'Create Job'}
        </Button>
      </DialogActions>
    </Dialog>
    <Dialog open={duplicatePrompt} onClose={() => setDuplicatePrompt(false)} maxWidth="xs" fullWidth>
      <DialogTitle>This customer and address already exist</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {duplicateJobs.length ? duplicateWarning(duplicateJobs) : 'This customer and address already exist.'} Are you
          sure you want to add another job?
        </Typography>
        {duplicateJobs.length ? (
          <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
            {duplicateJobs.map((job) => (
              <Typography key={job.id || job.title} component="li" variant="body2">
                {job.title} — {job.stateLabel}
              </Typography>
            ))}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDuplicatePrompt(false)}>Go back</Button>
        <Button
          variant="contained"
          onClick={() => {
            setDuplicatePrompt(false);
            handleSubmit(null, { confirmedDuplicate: true });
          }}
        >
          Add anyway
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
}

export default AddJobModal;

