/**
 * CustomersPage — Customer directory, detail editor, job list.
 * Routes: /customers, /customers-view (TV mode)
 * APIs: GET/PATCH /customers, GET /customers/global-search
 * Docs: ../../../docs/PAGES.md#customerspagetsx
 */
// @ts-nocheck — large page; tighten types incrementally
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  TextField,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  Chip,
  CircularProgress,
  Alert,
  TableSortLabel,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  useTheme,
  DialogContentText,
} from '@mui/material';
import {
  Search as SearchIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
  LocationOn as LocationIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Add as AddCircleIcon,
  Delete as DeleteOutlineIcon,
  Work as WorkIcon,
  Description as DescriptionIcon,
  Share as ShareIcon,
  VpnKey as GateIcon,
} from '@mui/icons-material';
import axios from 'axios';
import toast from 'react-hot-toast';
import JobDetailModal from '../components/jobs/JobDetailModal';
import EmployeeSmsRecipientField, {
  parseSmsRecipientSelection,
} from '../components/common/EmployeeSmsRecipientField';
import PhoneTextField from '../components/common/PhoneTextField';
import { formatNanpTyping, formatPhoneForDisplay, phoneSearchMatch } from '../utils/phoneFormat';
import { buildCustomerShareMessage } from '../utils/customerShareMessage';
import { formatMoney } from '../utils/paymentSchedule';
import { useAuth } from '../context/AuthContext';
import { useShopViewSensitive } from '../hooks/useShopViewSensitive';
import { useFinancialPinLockContext } from '../context/FinancialPinLockContext';
import { JOB_SOURCE_OPTIONS, formatJobSourceWithCompany, clipReferralCompany } from '../utils/jobSources';
import ReferralCompanyField, { rememberReferralCompany } from '../components/common/ReferralCompanyField';
import { useTenantRealtimeRefresh } from '../hooks/useSocketSubscription';
import { useIsMobile } from '../hooks/useIsMobile';
import { getTenantRoom } from '../services/socket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
function CustomersPage({ viewMode = false, externalViewControls = false }) {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, tenantIdForBranding } = useAuth();
  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const { isShopViewRole, hideSensitive: shopHideSensitive } = useShopViewSensitive(user?.role);
  const financialPin = useFinancialPinLockContext();
  const hideSensitive = shopHideSensitive || financialPin.hideFinancials;
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState(null);
  const [sortField, setSortField] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [editCustomerForm, setEditCustomerForm] = useState({});
  const [customerJobs, setCustomerJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareSmsRecipient, setShareSmsRecipient] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [sendingShare, setSendingShare] = useState(false);

  // Load customer list (up to 1000) for directory and search
  const fetchCustomers = async ({ background = false } = {}) => {
    try {
      if (!background) setLoading(true);
      const response = await axios.get(`${API_URL}/customers?limit=1000`);
      setCustomers(response.data.customers || response.data || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
      if (!background) toast.error('Failed to load customers');
    } finally {
      if (!background) setLoading(false);
    }
  };

  useTenantRealtimeRefresh(tenantRoom, () => fetchCustomers({ background: true }));

  useEffect(() => {
    const loadData = async () => {
      // First, fetch existing customers
      await fetchCustomers();
      
      // Then, check if we need to import CSV
      const hasImported = localStorage.getItem('csvImported');
      if (!hasImported) {
        try {
          const response = await axios.post(`${API_URL}/customers/upload-csv`);
          localStorage.setItem('csvImported', 'true');
          
          // Only show success message if customers were actually imported
          if (response.data.imported > 0) {
            toast.success(`Imported ${response.data.imported} customers from CSV`);
            if (response.data.errors > 0) {
              toast.error(`${response.data.errors} rows had errors`);
            }
            // Refresh the customer list after import
            await fetchCustomers();
          } else if (response.data.message) {
            // File not found or other non-error message
            console.log('CSV import:', response.data.message);
            // Don't show toast for file not found - it's expected on first load
          }
        } catch (error) {
          console.error('Error auto-importing CSV:', error);
          // Mark as imported even on failure so we don't keep retrying every load
          localStorage.setItem('csvImported', 'true');
          // Don't show error toast on auto-import failure, just log it
        }
      }
    };
    
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const customerIdFromUrl = searchParams.get('customerId');
    if (!customerIdFromUrl || customers.length === 0) return;

    const matchedCustomer = customers.find((c) => String(c._id) === String(customerIdFromUrl));
    if (matchedCustomer) {
      handleOpenContactModal(matchedCustomer);
      const next = new URLSearchParams(searchParams);
      next.delete('customerId');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, searchParams, setSearchParams]);

  // Filter and sort customers
  const filteredAndSortedCustomers = useMemo(() => {
    let filtered = customers.filter(customer => {
      const searchLower = searchTerm.toLowerCase();
      return (
        customer.name?.toLowerCase().includes(searchLower) ||
        customer.primaryEmail?.toLowerCase().includes(searchLower) ||
        phoneSearchMatch(customer.primaryPhone, searchTerm) ||
        (Array.isArray(customer.contactPhones) &&
          customer.contactPhones.some((cp) => phoneSearchMatch(cp?.value, searchTerm))) ||
        customer.address?.street?.toLowerCase().includes(searchLower) ||
        customer.address?.city?.toLowerCase().includes(searchLower)
      );
    });

    // Sort
    filtered.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Handle nested fields
      if (sortField === 'address') {
        aVal = `${a.address?.street || ''} ${a.address?.city || ''}`.trim();
        bVal = `${b.address?.street || ''} ${b.address?.city || ''}`.trim();
      }

      if (sortField === 'source') {
        aVal = formatJobSourceWithCompany(a.source, a.referralCompany);
        bVal = formatJobSourceWithCompany(b.source, b.referralCompany);
      }

      // Handle null/undefined
      if (!aVal && !bVal) return 0;
      if (!aVal) return 1;
      if (!bVal) return -1;

      // Compare
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [customers, searchTerm, sortField, sortOrder]);

  // Handle sort
  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const isInactiveCustomerJob = (job) =>
    Boolean(
      job?.isArchived ||
      job?.isDeadEstimate ||
      job?.isCompletedClosedOut ||
      job?.stage === 'FINAL_PAYMENT_CLOSED'
    );

  // Fetch all jobs for a customer (active, archived, dead estimates, and closed/completed)
  const fetchCustomerJobs = async (customerId) => {
    if (!customerId) return;
    try {
      setLoadingJobs(true);
      const response = await axios.get(`${API_URL}/customers/${customerId}/jobs`);
      const jobs = (Array.isArray(response.data) ? response.data : response.data.jobs || [])
        .sort((a, b) => {
          const aInactive = isInactiveCustomerJob(a);
          const bInactive = isInactiveCustomerJob(b);
          if (aInactive !== bInactive) return aInactive ? 1 : -1;
          return (a.title || '').localeCompare(b.title || '');
        });
      setCustomerJobs(jobs);
    } catch (error) {
      console.error('Error fetching customer jobs:', error);
      setCustomerJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  };

  const handleJobUpdate = async (jobId, updates) => {
    try {
      await axios.patch(`${API_URL}/jobs/${jobId}`, updates);
      toast.success('Job updated');
      if (selectedCustomer?._id) await fetchCustomerJobs(selectedCustomer._id);
    } catch (error) {
      console.error('Error updating job:', error);
      toast.error('Failed to update job');
      throw error;
    }
  };

  const handleJobDeletedOrArchived = async () => {
    if (selectedCustomer?._id) await fetchCustomerJobs(selectedCustomer._id);
  };

  const handleJobDataChanged = () => {
    if (selectedCustomer?._id) {
      fetchCustomerJobs(selectedCustomer._id);
    }
  };

  // Open contact modal
  const handleOpenContactModal = (customer) => {
    setSelectedCustomer(customer);
    setIsEditingCustomer(false);
    setEditCustomerForm({});
    setSelectedJobId(null);
    setContactModalOpen(true);
    fetchCustomerJobs(customer._id);
  };

  const handleCloseContactModal = () => {
    setContactModalOpen(false);
    setIsEditingCustomer(false);
    setEditCustomerForm({});
    setSelectedJobId(null);
  };

  const buildShareMessage = (customer) => {
    if (!customer) return '';
    const phones = getAllPhones(customer).map((p) => p.value).filter(Boolean);
    const emails = getAllEmails(customer).map((e) => e.value).filter(Boolean);
    return buildCustomerShareMessage({
      customer,
      extraPhones: phones,
      extraEmails: emails,
    });
  };

  const handleOpenShareDialog = () => {
    if (!selectedCustomer) return;
    setShareSmsRecipient('');
    setShareMessage(buildShareMessage(selectedCustomer));
    setShareDialogOpen(true);
  };

  useEffect(() => {
    if (!shareDialogOpen || !selectedCustomer) return;
    setShareMessage(buildShareMessage(selectedCustomer));
  }, [shareDialogOpen, selectedCustomer]);

  const handleCloseShareDialog = () => {
    setShareDialogOpen(false);
    setShareSmsRecipient('');
    setShareMessage('');
    setSendingShare(false);
  };

  const handleSendShareSms = async () => {
    const message = shareMessage.trim();
    if (!shareSmsRecipient) {
      toast.error('Enter a phone number or select a recipient');
      return;
    }
    if (!message) {
      toast.error('Message cannot be empty');
      return;
    }
    try {
      setSendingShare(true);
      await axios.post(`${API_URL}/twilio/send-sms`, {
        ...parseSmsRecipientSelection(shareSmsRecipient),
        message,
        customerId: selectedCustomer?._id,
      });
      toast.success('Customer info sent by text');
      handleCloseShareDialog();
    } catch (error) {
      console.error('Error sending customer share text:', error);
      toast.error(error.response?.data?.error || 'Failed to send text');
    } finally {
      setSendingShare(false);
    }
  };

  // Start editing customer
  const handleStartEditCustomer = () => {
    if (!selectedCustomer) return;
    setIsEditingCustomer(true);
    
    // Migrate old phones/emails to new structure if needed
    let contactPhones = selectedCustomer.contactPhones ? [...selectedCustomer.contactPhones] : [];
    if (selectedCustomer.primaryPhone && contactPhones.length === 0) {
      contactPhones.push({ label: 'Primary', value: selectedCustomer.primaryPhone });
    }
    if (selectedCustomer.phones && selectedCustomer.phones.length > 0) {
      selectedCustomer.phones.forEach(phone => {
        if (phone && !contactPhones.find(p => p.value === phone)) {
          contactPhones.push({ label: 'Phone', value: phone });
        }
      });
    }
    
    let contactEmails = selectedCustomer.contactEmails ? [...selectedCustomer.contactEmails] : [];
    if (selectedCustomer.primaryEmail && contactEmails.length === 0) {
      contactEmails.push({ label: 'Primary', value: selectedCustomer.primaryEmail });
    }
    if (selectedCustomer.emails && selectedCustomer.emails.length > 0) {
      selectedCustomer.emails.forEach(email => {
        if (email && !contactEmails.find(e => e.value === email)) {
          contactEmails.push({ label: 'Email', value: email });
        }
      });
    }
    
    setEditCustomerForm({
      name: selectedCustomer.name || '',
      primaryPhone: selectedCustomer.primaryPhone ? formatNanpTyping(selectedCustomer.primaryPhone) : '',
      primaryEmail: selectedCustomer.primaryEmail || '',
      phones: selectedCustomer.phones ? [...selectedCustomer.phones] : [],
      emails: selectedCustomer.emails ? [...selectedCustomer.emails] : [],
      contactPhones: contactPhones.map((cp) => ({
        ...cp,
        value: cp.value ? formatNanpTyping(cp.value) : '',
      })),
      contactEmails: contactEmails,
      address: {
        street: selectedCustomer.address?.street || '',
        city: selectedCustomer.address?.city || '',
        state: selectedCustomer.address?.state || '',
        zip: selectedCustomer.address?.zip || '',
      },
      addresses: selectedCustomer.addresses ? [...selectedCustomer.addresses] : [],
      notes: selectedCustomer.notes || '',
      gateCode: selectedCustomer.gateCode || '',
      source: selectedCustomer.source || 'other',
      referralCompany: selectedCustomer.referralCompany || '',
      tags: selectedCustomer.tags ? [...selectedCustomer.tags] : [],
    });
  };

  // Cancel editing
  const handleCancelEditCustomer = () => {
    setIsEditingCustomer(false);
    setEditCustomerForm({});
  };

  // Save customer edits
  const handleSaveCustomerEdit = async () => {
    if (!selectedCustomer) return;
    
    try {
      const contactPhones = editCustomerForm.contactPhones?.filter(cp => cp.value?.trim()) || [];
      const contactEmails = editCustomerForm.contactEmails?.filter(ce => ce.value?.trim()) || [];
      const primaryPhone = getPrimaryContactPhone(contactPhones) || editCustomerForm.primaryPhone || undefined;
      const primaryEmail = getPrimaryContactEmail(contactEmails) || undefined;
      const primaryEmailKey = String(primaryEmail || '').trim().toLowerCase();
      const emails = contactEmails
        .map((row) => String(row.value || '').trim())
        .filter((value, index, list) => {
          const key = value.toLowerCase();
          return key && key !== primaryEmailKey && list.findIndex((item) => item.toLowerCase() === key) === index;
        });

      // Prepare update data
      const updateData = {
        name: editCustomerForm.name.trim(),
        primaryPhone,
        primaryEmail,
        phones: editCustomerForm.phones || [],
        emails,
        contactPhones,
        contactEmails,
        address: (editCustomerForm.address.street || editCustomerForm.address.city) 
          ? editCustomerForm.address 
          : undefined,
        addresses: editCustomerForm.addresses || [],
        notes: editCustomerForm.notes || undefined,
        gateCode: String(editCustomerForm.gateCode || '').trim(),
        source: editCustomerForm.source || 'other',
        referralCompany:
          editCustomerForm.source === 'referral'
            ? clipReferralCompany(editCustomerForm.referralCompany)
            : '',
        tags: editCustomerForm.tags || [],
      };

      await axios.patch(`${API_URL}/customers/${selectedCustomer._id}`, updateData);
      if (updateData.source === 'referral' && updateData.referralCompany) {
        rememberReferralCompany(updateData.referralCompany);
      }
      toast.success('Customer updated successfully');
      
      // Refresh customer data
      const updatedResponse = await axios.get(`${API_URL}/customers/${selectedCustomer._id}`);
      const updatedCustomer = updatedResponse.data;
      setSelectedCustomer(updatedCustomer);
      setCustomers((prev) =>
        prev.map((customer) =>
          String(customer._id) === String(updatedCustomer._id) ? { ...customer, ...updatedCustomer } : customer,
        ),
      );
      setIsEditingCustomer(false);
      setEditCustomerForm({});
      
      // Refresh the customer list from server
      await fetchCustomers();
      // Refresh jobs if customer modal is open
      if (selectedCustomer) {
        fetchCustomerJobs(selectedCustomer._id);
      }
    } catch (error) {
      console.error('Error updating customer:', error);
      toast.error(error.response?.data?.error || 'Failed to update customer');
    }
  };

  // Add new phone
  const handleAddPhone = () => {
    setEditCustomerForm(prev => ({
      ...prev,
      contactPhones: [...(prev.contactPhones || []), { label: '', value: '' }]
    }));
  };

  // Remove phone
  const handleRemovePhone = (index) => {
    setEditCustomerForm(prev => ({
      ...prev,
      contactPhones: prev.contactPhones.filter((_, i) => i !== index)
    }));
  };

  // Update phone label
  const handleUpdatePhoneLabel = (index, label) => {
    setEditCustomerForm(prev => ({
      ...prev,
      contactPhones: prev.contactPhones.map((p, i) => i === index ? { ...p, label } : p)
    }));
  };

  // Update phone value
  const handleUpdatePhoneValue = (index, value) => {
    setEditCustomerForm((prev) => ({
      ...prev,
      contactPhones: prev.contactPhones.map((p, i) =>
        i === index ? { ...p, value: formatNanpTyping(value) } : p
      ),
    }));
  };

  // Add new email
  const handleAddEmail = () => {
    setEditCustomerForm(prev => ({
      ...prev,
      contactEmails: [...(prev.contactEmails || []), { label: '', value: '' }]
    }));
  };

  // Remove email
  const handleRemoveEmail = (index) => {
    setEditCustomerForm(prev => ({
      ...prev,
      contactEmails: prev.contactEmails.filter((_, i) => i !== index)
    }));
  };

  // Update email label
  const handleUpdateEmailLabel = (index, label) => {
    setEditCustomerForm(prev => ({
      ...prev,
      contactEmails: prev.contactEmails.map((e, i) => i === index ? { ...e, label } : e)
    }));
  };

  // Update email value
  const handleUpdateEmailValue = (index, value) => {
    setEditCustomerForm(prev => ({
      ...prev,
      contactEmails: prev.contactEmails.map((e, i) => i === index ? { ...e, value } : e)
    }));
  };

  // Add new address
  const handleAddAddress = () => {
    setEditCustomerForm(prev => ({
      ...prev,
      addresses: [...(prev.addresses || []), { street: '', city: '', state: '', zip: '', fullAddress: '' }]
    }));
  };

  // Remove address
  const handleRemoveAddress = (index) => {
    setEditCustomerForm(prev => ({
      ...prev,
      addresses: prev.addresses.filter((_, i) => i !== index)
    }));
  };

  // Update address
  const handleUpdateAddress = (index, field, value) => {
    setEditCustomerForm(prev => ({
      ...prev,
      addresses: prev.addresses.map((addr, i) => 
        i === index ? { ...addr, [field]: value } : addr
      )
    }));
  };

  // Add tag
  const handleAddTag = (tag) => {
    if (!tag.trim()) return;
    setEditCustomerForm(prev => ({
      ...prev,
      tags: [...(prev.tags || []), tag.trim()]
    }));
  };

  // Remove tag
  const handleRemoveTag = (index) => {
    setEditCustomerForm(prev => ({
      ...prev,
      tags: prev.tags.filter((_, i) => i !== index)
    }));
  };

  // Handle delete
  const handleDeleteClick = (customer) => {
    setCustomerToDelete(customer);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      await axios.delete(`${API_URL}/customers/${customerToDelete._id}`);
      toast.success('Customer deleted successfully');
      setDeleteDialogOpen(false);
      if (selectedCustomer?._id === customerToDelete?._id) {
        handleCloseContactModal();
        setSelectedCustomer(null);
      }
      setCustomerToDelete(null);
      fetchCustomers();
    } catch (error) {
      console.error('Error deleting customer:', error);
      toast.error('Failed to delete customer');
    }
  };

  // Format address for display
  const formatAddress = (address) => {
    if (!address) return '-';
    const parts = [];
    if (address.street) parts.push(address.street);
    if (address.city) parts.push(address.city);
    if (address.state) parts.push(address.state);
    if (address.zip) parts.push(address.zip);
    return parts.length > 0 ? parts.join(', ') : '-';
  };

  // Get all phones for a customer (with labels)
  const getAllPhones = (customer) => {
    // Use new structure if available
    if (customer.contactPhones && customer.contactPhones.length > 0) {
      return customer.contactPhones.filter(cp => cp.value);
    }
    // Fallback to old structure
    const phones = [];
    if (customer.primaryPhone) {
      phones.push({ label: 'Primary', value: customer.primaryPhone });
    }
    if (customer.phones && customer.phones.length > 0) {
      customer.phones.forEach(phone => {
        if (phone && !phones.find(p => p.value === phone)) {
          phones.push({ label: 'Phone', value: phone });
        }
      });
    }
    return phones;
  };

  const getPrimaryContactPhone = (contactPhones = []) => {
    const phones = contactPhones.filter((cp) => cp?.value?.trim());
    const labeledPrimary = phones.find((cp) => /^primary$/i.test(String(cp.label || '').trim()));
    return (labeledPrimary || phones[0])?.value?.trim() || '';
  };

  const getPrimaryContactEmail = (contactEmails = []) => {
    const emails = contactEmails.filter((ce) => ce?.value?.trim());
    const labeledPrimary = emails.find((ce) => /^primary$/i.test(String(ce.label || '').trim()));
    return (labeledPrimary || emails[0])?.value?.trim() || '';
  };

  // Get all emails for a customer (with labels)
  const getAllEmails = (customer) => {
    // Use new structure if available
    if (customer.contactEmails && customer.contactEmails.length > 0) {
      return customer.contactEmails.filter(ce => ce.value);
    }
    // Fallback to old structure
    const emails = [];
    if (customer.primaryEmail) {
      emails.push({ label: 'Primary', value: customer.primaryEmail });
    }
    if (customer.emails && customer.emails.length > 0) {
      customer.emails.forEach(email => {
        if (email && !emails.find(e => e.value === email)) {
          emails.push({ label: 'Email', value: email });
        }
      });
    }
    return emails;
  };

  const getDisplayPhone = (customer) => getAllPhones(customer)[0]?.value || customer.primaryPhone || '';

  const getDisplayEmail = (customer) => getAllEmails(customer)[0]?.value || customer.primaryEmail || '';

  // Get all addresses for a customer (profile + job-site addresses from linked jobs)
  const getAllAddresses = (customer, jobs = []) => {
    const addresses = [];
    const seenAddresses = new Set();

    // Add primary address first if it exists
    if (customer.address && (customer.address.street || customer.address.city)) {
      const primaryStr = formatAddress(customer.address);
      addresses.push({
        address: customer.address,
        display: primaryStr,
        isPrimary: true,
        isJobSite: false,
      });
      seenAddresses.add(primaryStr.toLowerCase());
    }

    // Add addresses from addresses array (avoid duplicates)
    if (customer.addresses && customer.addresses.length > 0) {
      customer.addresses.forEach((addr) => {
        const addrStr = addr.fullAddress || formatAddress(addr);
        const normalizedStr = addrStr.toLowerCase();
        if (!seenAddresses.has(normalizedStr)) {
          addresses.push({
            address: addr,
            display: addrStr,
            isPrimary: false,
            isJobSite: false,
          });
          seenAddresses.add(normalizedStr);
        }
      });
    }

    // Job site addresses (stored on each job as jobAddress — not copied to customer record)
    if (Array.isArray(jobs)) {
      jobs.forEach((job) => {
        const ja = job?.jobAddress;
        if (!ja || (!ja.street && !ja.city && !ja.state && !ja.zip)) return;
        const line = formatAddress(ja);
        if (!line || line === '-') return;
        const title = (job.title || 'Job').trim();
        addresses.push({
          address: ja,
          display: `${title} | ${line}`,
          isPrimary: false,
          isJobSite: true,
          jobId: job._id,
        });
      });
    }

    // Customer profile addresses first (primary, then others), then job sites by title
    const profileRows = addresses.filter((a) => !a.isJobSite);
    const jobRows = addresses.filter((a) => a.isJobSite);
    profileRows.sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return (a.display || '').localeCompare(b.display || '');
    });
    jobRows.sort((a, b) => (a.display || '').localeCompare(b.display || ''));

    return [...profileRows, ...jobRows];
  };

  const contactModalAddressList = useMemo(() => {
    if (!selectedCustomer) return [];
    return getAllAddresses(selectedCustomer, customerJobs);
  }, [selectedCustomer, customerJobs]);

  // Truncate notes for display
  const truncateNotes = (notes, maxLength = 50) => {
    if (!notes) return '-';
    if (notes.length <= maxLength) return notes;
    return notes.substring(0, maxLength) + '...';
  };

  const isReadonlyView = Boolean(viewMode);

  return (
    <Box sx={{ p: { xs: 1, sm: 2, md: 3 } }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', 
        flexDirection: { xs: 'column', sm: 'row' }, 
        justifyContent: 'space-between', 
        alignItems: { xs: 'stretch', sm: 'center' },
        mb: { xs: 2, sm: 3 },
        gap: { xs: 2, sm: 0 }
      }}>
        <Typography variant="h4" sx={{ fontWeight: 600, fontSize: { xs: '1.5rem', sm: '2rem' } }}>
          {isReadonlyView ? 'Customers View' : 'Customers'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {isReadonlyView && !externalViewControls ? (
            <>
              <Button
                variant="outlined"
                size="small"
                onClick={() => navigate('/pipeline-view')}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Pipeline view
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => navigate('/calendar-view')}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Calendar view
              </Button>
              <Button
                variant="contained"
                size="small"
                onClick={() => navigate('/customers-view')}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Customers view
              </Button>
              <Button
                variant="contained"
                size="small"
                onClick={() => navigate('/customers')}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Exit Customers view
              </Button>
            </>
          ) : !isReadonlyView && !isMobile ? (
            /* Customer creation stays on desktop — phones are for looking things up. */
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              sx={{ borderRadius: '8px', textTransform: 'none' }}
              onClick={async () => {
                try {
                  // Create a new customer via API
                  const response = await axios.post(`${API_URL}/customers`, {
                    name: 'New Customer',
                    primaryPhone: '',
                    primaryEmail: '',
                    contactPhones: [],
                    contactEmails: [],
                    address: { street: '', city: '', state: '', zip: '' },
                    notes: '',
                    gateCode: '',
                    source: 'other',
                    skipInitialJob: true,
                  });
                  const newCustomer = response.data;
                  setCustomers([newCustomer, ...customers]);
                  setSelectedCustomer(newCustomer);
                  handleStartEditCustomer();
                  setContactModalOpen(true);
                  toast.success('New customer created');
                } catch (error) {
                  console.error('Error creating customer:', error);
                  toast.error('Failed to create customer');
                }
              }}
            >
              Add Customer
            </Button>
          ) : null}
        </Box>
      </Box>

      {/* Search */}
      <TextField
        fullWidth
        placeholder="Search customers by name, email, phone, or address..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        sx={{ mb: 3 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
      />

      {/* Table */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
        {isMobile && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.75, fontStyle: 'italic' }}
          >
            Tap a customer to see email, source and notes.
          </Typography>
        )}
        <TableContainer 
          component={Paper} 
          sx={{ 
            borderRadius: '8px',
            overflowX: 'auto',
            maxWidth: '100%',
          }}
        >
          <Table size={isMobile ? 'small' : 'medium'} sx={{ minWidth: isMobile ? 0 : 650 }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: theme.palette.mode === 'dark' ? '#2A2A2A' : '#f5f5f5' }}>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'name'}
                    direction={sortField === 'name' ? sortOrder : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    Name
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'primaryPhone'}
                    direction={sortField === 'primaryPhone' ? sortOrder : 'asc'}
                    onClick={() => handleSort('primaryPhone')}
                  >
                    Phone
                  </TableSortLabel>
                </TableCell>
                {/* Phones show name, phone and address only — the rest is in the row's detail popup. */}
                {!isMobile && (
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'primaryEmail'}
                    direction={sortField === 'primaryEmail' ? sortOrder : 'asc'}
                    onClick={() => handleSort('primaryEmail')}
                  >
                    Email
                  </TableSortLabel>
                </TableCell>
                )}
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'address'}
                    direction={sortField === 'address' ? sortOrder : 'asc'}
                    onClick={() => handleSort('address')}
                  >
                    Address
                  </TableSortLabel>
                </TableCell>
                {!isMobile && (
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'source'}
                    direction={sortField === 'source' ? sortOrder : 'asc'}
                    onClick={() => handleSort('source')}
                  >
                    Source
                  </TableSortLabel>
                </TableCell>
                )}
                {!isMobile && <TableCell>Notes</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredAndSortedCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isMobile ? 3 : 6} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm ? 'No customers found matching your search' : 'No customers found'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedCustomers.map((customer) => (
                  <TableRow 
                    key={customer._id} 
                    hover
                    onClick={() => handleOpenContactModal(customer)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ fontWeight: isMobile ? 600 : 400 }}>{customer.name || '-'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatPhoneForDisplay(getDisplayPhone(customer)) || '-'}
                    </TableCell>
                    {!isMobile && <TableCell>{getDisplayEmail(customer) || '-'}</TableCell>}
                    <TableCell>
                      {formatAddress(customer.address)}
                    </TableCell>
                    {!isMobile && (
                    <TableCell>
                      <Chip
                        label={formatJobSourceWithCompany(customer.source, customer.referralCompany)}
                        size="small"
                        sx={{ textTransform: 'capitalize' }}
                      />
                    </TableCell>
                    )}
                    {!isMobile && (
                    <TableCell>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {truncateNotes(customer.notes)}
                      </Typography>
                    </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Customer</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>{customerToDelete?.name}</strong>? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Contact Modal */}
      <Dialog 
        open={contactModalOpen} 
        onClose={handleCloseContactModal}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{selectedCustomer?.name || 'Customer Details'}</span>
          {!isEditingCustomer && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Tooltip title="Share via text">
                <IconButton onClick={handleOpenShareDialog} color="primary" size="small">
                  <ShareIcon />
                </IconButton>
              </Tooltip>
              {!isReadonlyView ? (
                <Tooltip title="Edit customer">
                  <IconButton onClick={handleStartEditCustomer} color="primary" size="small">
                    <EditIcon />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Box>
          )}
        </DialogTitle>
        <DialogContent>
          {selectedCustomer && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 2 }}>
              {isEditingCustomer ? (
                // Edit Mode
                <>
                  {/* Name */}
                  <TextField
                    label="Name"
                    value={editCustomerForm.name || ''}
                    onChange={(e) => setEditCustomerForm({ ...editCustomerForm, name: e.target.value })}
                    fullWidth
                    required
                  />

                  {/* Phone Numbers */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <PhoneIcon color="primary" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Phone Numbers
                      </Typography>
                      <IconButton size="small" onClick={handleAddPhone} color="primary">
                        <AddCircleIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    {(editCustomerForm.contactPhones || []).map((phone, idx) => (
                      <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                        <TextField
                          size="small"
                          value={phone.label || ''}
                          onChange={(e) => handleUpdatePhoneLabel(idx, e.target.value)}
                          placeholder="Label (e.g., John's number, Office)"
                          sx={{ width: '40%' }}
                        />
                        <PhoneTextField
                          size="small"
                          value={phone.value || ''}
                          onChange={(e) => handleUpdatePhoneValue(idx, e.target.value)}
                          placeholder="(949) 555-1234"
                          fullWidth
                          InputProps={{
                            startAdornment: <PhoneIcon sx={{ mr: 1, color: 'action.active', fontSize: '1rem' }} />,
                          }}
                        />
                        <IconButton size="small" onClick={() => handleRemovePhone(idx)} color="error">
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>

                  {/* Email Addresses */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <EmailIcon color="primary" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Email Addresses
                      </Typography>
                      <IconButton size="small" onClick={handleAddEmail} color="primary">
                        <AddCircleIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    {(editCustomerForm.contactEmails || []).map((email, idx) => (
                      <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                        <TextField
                          size="small"
                          value={email.label || ''}
                          onChange={(e) => handleUpdateEmailLabel(idx, e.target.value)}
                          placeholder="Label (e.g., John's email, Office)"
                          sx={{ width: '40%' }}
                        />
                        <TextField
                          size="small"
                          value={email.value || ''}
                          onChange={(e) => handleUpdateEmailValue(idx, e.target.value)}
                          placeholder="Email address"
                          fullWidth
                          type="email"
                          InputProps={{
                            startAdornment: <EmailIcon sx={{ mr: 1, color: 'action.active', fontSize: '1rem' }} />,
                          }}
                        />
                        <IconButton size="small" onClick={() => handleRemoveEmail(idx)} color="error">
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>

                  {/* Primary Address */}
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                      Primary Address
                    </Typography>
                    <TextField
                      label="Street"
                      value={editCustomerForm.address?.street || ''}
                      onChange={(e) => setEditCustomerForm({
                        ...editCustomerForm,
                        address: { ...editCustomerForm.address, street: e.target.value }
                      })}
                      fullWidth
                      sx={{ mb: 1 }}
                    />
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <TextField
                        label="City"
                        value={editCustomerForm.address?.city || ''}
                        onChange={(e) => setEditCustomerForm({
                          ...editCustomerForm,
                          address: { ...editCustomerForm.address, city: e.target.value }
                        })}
                        sx={{ flex: 1, minWidth: 140 }}
                      />
                      <TextField
                        label="State"
                        value={editCustomerForm.address?.state || ''}
                        onChange={(e) => setEditCustomerForm({
                          ...editCustomerForm,
                          address: { ...editCustomerForm.address, state: e.target.value }
                        })}
                        sx={{ width: 100 }}
                      />
                      <TextField
                        label="ZIP"
                        value={editCustomerForm.address?.zip || ''}
                        onChange={(e) => setEditCustomerForm({
                          ...editCustomerForm,
                          address: { ...editCustomerForm.address, zip: e.target.value }
                        })}
                        sx={{ width: 120 }}
                      />
                    </Box>
                  </Box>

                  {/* Additional Addresses */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <LocationIcon color="primary" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Additional Addresses
                      </Typography>
                      <IconButton size="small" onClick={handleAddAddress} color="primary">
                        <AddCircleIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    {editCustomerForm.addresses?.map((addr, idx) => (
                      <Box key={idx} sx={{ mb: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                          <Typography variant="caption">Address {idx + 1}</Typography>
                          <IconButton size="small" onClick={() => handleRemoveAddress(idx)} color="error">
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Box>
                        <TextField
                          size="small"
                          label="Full Address"
                          value={addr.fullAddress || ''}
                          onChange={(e) => handleUpdateAddress(idx, 'fullAddress', e.target.value)}
                          fullWidth
                          sx={{ mb: 1 }}
                          placeholder="Or enter full address"
                        />
                        <TextField
                          size="small"
                          label="Street"
                          value={addr.street || ''}
                          onChange={(e) => handleUpdateAddress(idx, 'street', e.target.value)}
                          fullWidth
                          sx={{ mb: 1 }}
                        />
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <TextField
                            size="small"
                            label="City"
                            value={addr.city || ''}
                            onChange={(e) => handleUpdateAddress(idx, 'city', e.target.value)}
                            sx={{ flex: 1, minWidth: 140 }}
                          />
                          <TextField
                            size="small"
                            label="State"
                            value={addr.state || ''}
                            onChange={(e) => handleUpdateAddress(idx, 'state', e.target.value)}
                            sx={{ width: 100 }}
                          />
                          <TextField
                            size="small"
                            label="ZIP"
                            value={addr.zip || ''}
                            onChange={(e) => handleUpdateAddress(idx, 'zip', e.target.value)}
                            sx={{ width: 120 }}
                          />
                        </Box>
                      </Box>
                    ))}
                  </Box>

                  {/* Source */}
                  <FormControl fullWidth>
                    <InputLabel>Source</InputLabel>
                    <Select
                      value={editCustomerForm.source || 'other'}
                      onChange={(e) =>
                        setEditCustomerForm({
                          ...editCustomerForm,
                          source: e.target.value,
                          referralCompany: e.target.value === 'referral' ? editCustomerForm.referralCompany : '',
                        })
                      }
                      label="Source"
                    >
                      {JOB_SOURCE_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {editCustomerForm.source === 'referral' ? (
                    <ReferralCompanyField
                      value={editCustomerForm.referralCompany || ''}
                      onChange={(referralCompany) =>
                        setEditCustomerForm({ ...editCustomerForm, referralCompany })
                      }
                    />
                  ) : null}

                  {/* Gate code is shared with installers; notes stay internal. */}
                  <TextField
                    label="Gate code"
                    value={editCustomerForm.gateCode || ''}
                    onChange={(e) => setEditCustomerForm({ ...editCustomerForm, gateCode: e.target.value })}
                    fullWidth
                    placeholder="e.g. #1234 or call 555 for entry"
                    helperText="Included when you text customer info from here or from a job card."
                  />

                  {/* Notes */}
                  <TextField
                    label="Notes"
                    value={editCustomerForm.notes || ''}
                    onChange={(e) => setEditCustomerForm({ ...editCustomerForm, notes: e.target.value })}
                    fullWidth
                    multiline
                    rows={3}
                  />

                  {/* Tags */}
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                      Tags
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                      {editCustomerForm.tags?.map((tag, idx) => (
                        <Chip
                          key={idx}
                          label={tag}
                          size="small"
                          onDelete={() => handleRemoveTag(idx)}
                        />
                      ))}
                    </Box>
                    <TextField
                      size="small"
                      placeholder="Add tag and press Enter"
                      fullWidth
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleAddTag(e.target.value);
                          e.target.value = '';
                        }
                      }}
                    />
                  </Box>
                </>
              ) : (
                // View Mode
                <>
                  {/* Phone Numbers */}
                  {getAllPhones(selectedCustomer).length > 0 && (
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <PhoneIcon color="primary" />
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          Phone Numbers ({getAllPhones(selectedCustomer).length})
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 4 }}>
                        {getAllPhones(selectedCustomer).map((phone, idx) => (
                          <Box 
                            key={idx}
                            sx={{
                              pl: 2,
                              borderLeft: '3px solid #e0e0e0',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1
                            }}
                          >
                            <Typography 
                              variant="body2"
                              sx={{
                                fontWeight: phone.label ? 600 : 400,
                                color: phone.label ? 'text.primary' : 'text.secondary',
                                minWidth: '100px'
                              }}
                            >
                              {phone.label || 'Phone'}:
                            </Typography>
                            <Typography 
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.9rem',
                                flex: 1
                              }}
                            >
                              {formatPhoneForDisplay(phone.value)}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Email Addresses */}
                  {getAllEmails(selectedCustomer).length > 0 && (
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <EmailIcon color="primary" />
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          Email Addresses ({getAllEmails(selectedCustomer).length})
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 4 }}>
                        {getAllEmails(selectedCustomer).map((email, idx) => (
                          <Box 
                            key={idx}
                            sx={{
                              pl: 2,
                              borderLeft: '3px solid #e0e0e0',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1
                            }}
                          >
                            <Typography 
                              variant="body2"
                              sx={{
                                fontWeight: email.label ? 600 : 400,
                                color: email.label ? 'text.primary' : 'text.secondary',
                                minWidth: '100px'
                              }}
                            >
                              {email.label || 'Email'}:
                            </Typography>
                            <Typography 
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.9rem',
                                flex: 1
                              }}
                            >
                              {email.value}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Addresses (customer profile + job site addresses from jobs) */}
                  {contactModalAddressList.length > 0 && (
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <LocationIcon color="primary" />
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          Addresses ({contactModalAddressList.length})
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 4 }}>
                        {contactModalAddressList.map((addrObj, idx) => (
                          <Typography 
                            key={addrObj.jobId || `addr-${idx}`}
                            variant="body2"
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: '0.9rem',
                              pl: 2,
                              borderLeft: addrObj.isJobSite
                                ? `3px solid ${theme.palette.warning.main}`
                                : addrObj.isPrimary
                                  ? `3px solid ${theme.palette.primary.main}`
                                  : `3px solid ${theme.palette.divider}`,
                            }}
                          >
                            {addrObj.display}
                            {addrObj.isPrimary && (
                              <Chip label="Primary" size="small" sx={{ ml: 1, height: 20 }} />
                            )}
                            {addrObj.isJobSite && (
                              <Chip
                                label="Job site"
                                size="small"
                                color="warning"
                                variant="outlined"
                                sx={{ ml: 1, height: 20 }}
                              />
                            )}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Source */}
                  {selectedCustomer.source && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Source:
                      </Typography>
                      <Chip
                        label={formatJobSourceWithCompany(
                          selectedCustomer.source,
                          selectedCustomer.referralCompany,
                        )}
                        size="small"
                        sx={{ ml: 2 }}
                      />
                    </Box>
                  )}

                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                      <GateIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Gate code
                      </Typography>
                    </Box>
                    <Typography variant="body2" color={selectedCustomer.gateCode ? 'text.primary' : 'text.secondary'} sx={{ pl: 3.5 }}>
                      {selectedCustomer.gateCode || '—'}
                    </Typography>
                  </Box>

                  {/* Notes */}
                  {selectedCustomer.notes && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Notes:
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ pl: 2 }}>
                        {selectedCustomer.notes}
                      </Typography>
                    </Box>
                  )}

                  {/* Tags */}
                  {selectedCustomer.tags && selectedCustomer.tags.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Tags:
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', pl: 2 }}>
                        {selectedCustomer.tags.map((tag, idx) => (
                          <Chip key={idx} label={tag} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Jobs */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <WorkIcon color="primary" />
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        Jobs ({customerJobs.length})
                      </Typography>
                    </Box>
                    {loadingJobs ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : customerJobs.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 4 }}>
                        {customerJobs.map((job) => (
                          <Box
                            key={job._id}
                            sx={{
                              p: 1.5,
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              '&:hover': {
                                backgroundColor: 'action.hover',
                                cursor: 'pointer',
                              },
                            }}
                            onClick={() => {
                              if (job?._id) setSelectedJobId(job._id);
                            }}
                          >
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                                  {job.title}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                                  <Chip
                                    label={job.stage?.replace(/_/g, ' ') || 'Unknown'}
                                    size="small"
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                  />
                                  {job.isArchived && (
                                    <Chip
                                      label="Archived"
                                      size="small"
                                      color="default"
                                      sx={{ height: 20, fontSize: '0.7rem' }}
                                    />
                                  )}
                                  {job.isDeadEstimate && (
                                    <Chip
                                      label="Dead Estimate"
                                      size="small"
                                      color="warning"
                                      sx={{ height: 20, fontSize: '0.7rem' }}
                                    />
                                  )}
                                  {(job.isCompletedClosedOut || job.stage === 'FINAL_PAYMENT_CLOSED') && (
                                    <Chip
                                      label={job.isCompletedClosedOut ? 'Closed Out' : 'Completed'}
                                      size="small"
                                      color="success"
                                      sx={{ height: 20, fontSize: '0.7rem' }}
                                    />
                                  )}
                                  {!hideSensitive && (job.valueEstimated || job.valueContracted) && (
                                    <Typography variant="caption" color="text.secondary">
                                      {formatMoney(job.valueContracted || job.valueEstimated)}
                                    </Typography>
                                  )}
                                  {hideSensitive && (
                                    <Typography variant="caption" color="text.secondary">
                                      Locked
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                              <DescriptionIcon sx={{ fontSize: 16, color: 'text.secondary', ml: 1 }} titleAccess="View job details" />
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ pl: 4, fontStyle: 'italic' }}>
                        No jobs found for this customer
                      </Typography>
                    )}
                  </Box>

                  {/* Show message if no contact info */}
                  {getAllPhones(selectedCustomer).length === 0 && 
                   getAllEmails(selectedCustomer).length === 0 && 
                   contactModalAddressList.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                      No contact information available
                    </Typography>
                  )}
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={isEditingCustomer ? { justifyContent: 'space-between', px: 3, pb: 2 } : undefined}>
          {isEditingCustomer ? (
            <>
              {!isReadonlyView && (
                <Button
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => handleDeleteClick(selectedCustomer)}
                >
                  Delete
                </Button>
              )}
              <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
                <Button onClick={handleCancelEditCustomer}>Cancel</Button>
                <Button onClick={handleSaveCustomerEdit} variant="contained" startIcon={<SaveIcon />}>
                  Save
                </Button>
              </Box>
            </>
          ) : (
            <Button onClick={handleCloseContactModal}>Close</Button>
          )}
        </DialogActions>
      </Dialog>

      <JobDetailModal
        jobId={selectedJobId}
        open={!!selectedJobId}
        onClose={() => setSelectedJobId(null)}
        onJobUpdate={handleJobUpdate}
        onJobDataChanged={handleJobDataChanged}
        onJobDelete={handleJobDeletedOrArchived}
        onJobArchive={handleJobDeletedOrArchived}
        sx={(theme) => ({ zIndex: theme.zIndex.modal + 2 })}
        hideSensitive={hideSensitive}
        onRequestSensitiveUnlock={financialPin.openUnlockDialog}
        shopDisplayMode={isReadonlyView}
      />
      <Dialog open={shareDialogOpen} onClose={handleCloseShareDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Share Customer by Text</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Search for an employee or type any phone number to send the text to.
          </DialogContentText>
          <EmployeeSmsRecipientField
            dialogOpen={shareDialogOpen}
            value={shareSmsRecipient}
            onChange={setShareSmsRecipient}
            disabled={sendingShare}
            sx={{ mb: 2 }}
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
          <Button
            variant="contained"
            onClick={handleSendShareSms}
            disabled={sendingShare}
            startIcon={sendingShare ? <CircularProgress size={16} /> : <ShareIcon />}
          >
            {sendingShare ? 'Sending...' : 'Send Text'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default CustomersPage;

