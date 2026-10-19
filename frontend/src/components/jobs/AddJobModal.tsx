// @ts-nocheck — large modal; tighten types incrementally
import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  CircularProgress,
  Autocomplete,
  Chip,
  Typography,
  IconButton,
} from '@mui/material';
import { Add as AddIcon, Close as CloseIcon, InsertDriveFile as FileIcon } from '@mui/icons-material';
import axios from 'axios';
import toast from 'react-hot-toast';
import PhoneTextField from '../common/PhoneTextField';
import { formatNanpTyping, formatPhoneForDisplay } from '../../utils/phoneFormat';
import { JOB_SOURCE_OPTIONS, sanitizeMoneyTypingInput, clipReferralCompany } from '../../utils/jobSources';
import ReferralCompanyField, { rememberReferralCompany } from '../common/ReferralCompanyField';

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
    source: 'other',
    referralCompany: '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [customers, setCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerInputValue, setCustomerInputValue] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setPendingFiles((prev) => {
        revokePendingPreviews(prev);
        return [];
      });
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
      source: 'other',
      referralCompany: '',
    });
    setErrors({});
    setCustomerInputValue(name);
    setPendingFiles((prev) => {
      revokePendingPreviews(prev);
      return [];
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
  }, [open, initialCustomerName, initialDescription, initialTitle]);

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
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.title.trim()) {
      newErrors.title = 'Job title is required';
    }
    if (!formData.customerName.trim() && !formData.customerId) {
      newErrors.customerName = 'Customer name is required';
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

  const handleSubmit = async () => {
    if (!validate()) {
      return;
    }

    try {
      setSaving(true);
      
      // Use existing customer ID if selected, otherwise find or create
      let customerId = formData.customerId;
      const customerName = formData.customerName.trim();
      
      if (!customerId) {
        // Need to find or create customer
        try {
          const existingCustomer = customers.find(
            (c) => c.name.toLowerCase() === customerName.toLowerCase()
          );
          
          if (existingCustomer) {
            customerId = existingCustomer._id;
            // For existing customers, only update if fields are completely missing
            // Don't overwrite existing data - job-specific info will be stored on the job
            const updateData = {};
            if (formData.customerPhone && !existingCustomer.primaryPhone) {
              updateData.primaryPhone = formData.customerPhone;
            }
            if (formData.customerEmail && !existingCustomer.primaryEmail) {
              updateData.primaryEmail = formData.customerEmail;
            }
            if ((formData.customerAddress.street || formData.customerAddress.city) && 
                (!existingCustomer.address?.street && !existingCustomer.address?.city)) {
              updateData.address = formData.customerAddress;
            }
            if (Object.keys(updateData).length > 0) {
              await axios.patch(`${API_URL}/customers/${customerId}`, updateData);
            }
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
      
      // Create the job
      const jobData = {
        title: formData.title.trim(),
        description: formData.description.trim() || '',
        customerId: customerId,
        stage: (initialStage && String(initialStage).trim()) || 'ESTIMATE_IN_PROGRESS',
        source: formData.source,
        referralCompany: formData.source === 'referral' ? clipReferralCompany(formData.referralCompany) : '',
      };
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

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create New Job</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Job Title"
            value={formData.title}
            onChange={(e) => handleChange('title', e.target.value)}
            required
            error={!!errors.title}
            helperText={errors.title}
            fullWidth
            autoFocus
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
                helperText={errors.customerName || 'Select existing customer or type to create new'}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
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

          <Box sx={{ display: 'flex', gap: 2 }}>
            <PhoneTextField
              label="Phone"
              value={formData.customerPhone}
              onChange={(e) => handleChange('customerPhone', e.target.value)}
              fullWidth
              placeholder="(949) 555-1234"
            />
            <TextField
              label="Email"
              value={formData.customerEmail}
              onChange={(e) => handleChange('customerEmail', e.target.value)}
              type="email"
              fullWidth
              placeholder="customer@example.com"
            />
          </Box>

          <TextField
            label="Street Address"
            value={formData.customerAddress.street}
            onChange={(e) => handleAddressChange('street', e.target.value)}
            fullWidth
            placeholder="123 Main St"
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="City"
              value={formData.customerAddress.city}
              onChange={(e) => handleAddressChange('city', e.target.value)}
              sx={{ flex: 1 }}
              placeholder="San Clemente"
              fullWidth
            />
            <TextField
              label="State"
              value={formData.customerAddress.state}
              onChange={(e) => handleAddressChange('state', e.target.value)}
              sx={{ width: 100 }}
              placeholder="CA"
            />
            <TextField
              label="ZIP"
              value={formData.customerAddress.zip}
              onChange={(e) => handleAddressChange('zip', e.target.value)}
              sx={{ width: 120 }}
              placeholder="92672"
            />
          </Box>

          <TextField
            label="Estimated Value"
            type="text"
            inputMode="decimal"
            value={formData.valueEstimated}
            onChange={(e) => handleChange('valueEstimated', sanitizeMoneyTypingInput(e.target.value))}
            error={!!errors.valueEstimated}
            helperText={errors.valueEstimated || 'Optional'}
            fullWidth
            placeholder="0.00"
            slotProps={{
              input: {
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

          <Box sx={{ mt: 1, p: 1.5, bgcolor: 'info.light', borderRadius: 1 }}>
            <Box sx={{ fontSize: '0.875rem', color: 'info.dark' }}>
              <strong>Note:</strong> New jobs will be created in the <strong>Estimate Current, first 5 days</strong> stage.
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={saving}
        >
          {saving ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
          {saving && pendingFiles.length ? 'Uploading…' : saving ? 'Creating…' : 'Create Job'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AddJobModal;

