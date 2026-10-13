/**
 * CompletedJobsPage — Closed-out / paid jobs.
 * Route: /completed-jobs
 * API: GET /jobs/completed
 * Docs: ../../../docs/PAGES.md#completedjobspagetsx
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Typography,
  Container,
  Box,
  Card,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  useTheme,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  EditCalendar as EditCalendarIcon,
  Restore as RestoreIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { formatMoney } from '../utils/paymentSchedule';
import toast from 'react-hot-toast';
import JobDetailModal from '../components/jobs/JobDetailModal';
import { useAuth } from '../context/AuthContext';
import { useShopViewSensitive } from '../hooks/useShopViewSensitive';
import { useTenantRealtimeRefresh } from '../hooks/useSocketSubscription';
import { getTenantRoom } from '../services/socket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function CompletedJobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const { user, tenantIdForBranding } = useAuth();
  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const { hideSensitive } = useShopViewSensitive(user?.role);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [contextMenuJob, setContextMenuJob] = useState(null);
  const [editingCloseDateJob, setEditingCloseDateJob] = useState(null);
  const [closeDateDialogOpen, setCloseDateDialogOpen] = useState(false);
  const [closeDateInput, setCloseDateInput] = useState('');
  const [savingCloseDate, setSavingCloseDate] = useState(false);
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
  const [reopenJob, setReopenJob] = useState(null);
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    fetchCompletedJobs();
  }, []);

  useTenantRealtimeRefresh(tenantRoom, () => fetchCompletedJobs({ background: true }));

  useEffect(() => {
    const jobIdFromUrl = searchParams.get('jobId');
    if (!jobIdFromUrl) return;
    setSelectedJobId(jobIdFromUrl);
    const next = new URLSearchParams(searchParams);
    next.delete('jobId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const fetchCompletedJobs = async ({ background = false } = {}) => {
    try {
      if (!background) setLoading(true);
      const response = await axios.get(`${API_URL}/jobs/completed`);
      setCompletedJobs(response.data);
    } catch (error) {
      console.error('Error fetching completed jobs:', error);
      if (!background) toast.error('Failed to load completed jobs');
    } finally {
      if (!background) setLoading(false);
    }
  };

  const formatCurrency = formatMoney;

  const getTotalValue = (jobs) => {
    return jobs.reduce((sum, job) => sum + (job.valueContracted || job.valueEstimated || 0), 0);
  };

  const handleJobUpdate = async (jobId, updates) => {
    try {
      await axios.patch(`${API_URL}/jobs/${jobId}`, updates);
      toast.success('Job updated');
      fetchCompletedJobs();
    } catch (error) {
      console.error('Error updating job:', error);
      toast.error('Failed to update job');
    }
  };

  const handleJobDelete = async (jobId) => {
    await fetchCompletedJobs();
  };

  const handleJobArchive = async (jobId) => {
    await fetchCompletedJobs();
  };

  const handleJobDataChanged = () => {
    fetchCompletedJobs();
  };

  const handleContextMenu = (event, job) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(
      contextMenu === null
        ? { mouseX: event.clientX + 2, mouseY: event.clientY - 6 }
        : null
    );
    setContextMenuJob(job);
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
    setContextMenuJob(null);
  };

  const openCloseDateDialog = () => {
    if (!contextMenuJob) return;
    setEditingCloseDateJob(contextMenuJob);
    const source =
      contextMenuJob.completedClosedOutAt ||
      contextMenuJob.finalPayment?.paidAt ||
      contextMenuJob.updatedAt ||
      contextMenuJob.createdAt;
    const date = source ? new Date(source) : new Date();
    const yyyyMmDd = Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    setCloseDateInput(yyyyMmDd);
    setCloseDateDialogOpen(true);
    handleCloseContextMenu();
  };

  const openReopenDialog = () => {
    if (!contextMenuJob) return;
    setReopenJob(contextMenuJob);
    setReopenDialogOpen(true);
    handleCloseContextMenu();
  };

  const handleConfirmReopenFromCompleted = async () => {
    if (!reopenJob?._id) return;
    const jobId = reopenJob._id;
    try {
      setReopening(true);
      await axios.post(`${API_URL}/jobs/${jobId}/reopen-from-completed`, {});
      toast.success('Job returned to pipeline (Installed)');
      setReopenDialogOpen(false);
      setReopenJob(null);
      if (selectedJobId && String(selectedJobId) === String(jobId)) {
        setSelectedJobId(null);
      }
      await fetchCompletedJobs();
    } catch (error) {
      console.error('Error reopening job:', error);
      const data = error.response?.data;
      const fromBody =
        data && typeof data === 'object'
          ? data.error || data.message
          : typeof data === 'string'
            ? data.replace(/<[^>]*>/g, '').trim().slice(0, 240)
            : null;
      const status = error.response?.status;
      const msg =
        fromBody ||
        error.message ||
        (status ? `Request failed (${status})` : 'Failed to return job to pipeline');
      toast.error(msg);
    } finally {
      setReopening(false);
    }
  };

  const handleSaveCloseDate = async () => {
    if (!editingCloseDateJob || !closeDateInput) {
      toast.error('Please pick a valid date');
      return;
    }
    try {
      setSavingCloseDate(true);
      await axios.patch(`${API_URL}/jobs/${editingCloseDateJob._id}`, {
        completedClosedOutAt: new Date(`${closeDateInput}T12:00:00.000Z`).toISOString(),
        isCompletedClosedOut: true,
      });
      toast.success('Close date updated');
      setCloseDateDialogOpen(false);
      await fetchCompletedJobs();
    } catch (error) {
      console.error('Error updating close date:', error);
      toast.error(error.response?.data?.error || 'Failed to update close date');
    } finally {
      setSavingCloseDate(false);
    }
  };

  return (
    <Box>
      {/* Main Content */}
      <Container maxWidth="xl" sx={{ py: 4 }}>
        {/* Page Header */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h1" sx={{ mb: 1 }}>
            Completed Jobs
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            Jobs filed here after they are closed out from Final Payment Closed
          </Typography>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : completedJobs.length === 0 ? (
          <Card sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">
              No completed jobs yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Close out jobs from the Final Payment Closed column to file them here
            </Typography>
          </Card>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {completedJobs.map((group) => (
              <Accordion
                key={`${group.year}-${group.month}`}
                defaultExpanded={completedJobs.indexOf(group) === 0}
                sx={{
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px !important',
                  '&:before': { display: 'none' },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  sx={{
                    px: 3,
                    py: 2,
                    '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.02)' },
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', pr: 2 }}>
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600 }}>
                        {group.monthName} {group.year}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        {group.jobs.length} job{group.jobs.length !== 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <Typography variant="h6" sx={{ color: 'success.main', fontWeight: 500 }}>
                        {hideSensitive ? 'Locked' : formatCurrency(getTotalValue(group.jobs))}
                      </Typography>
                    </Box>
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 3, pb: 2.5 }}>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(188px, 204px))',
                      justifyContent: 'start',
                      gap: 1.25,
                      mt: 1,
                    }}
                  >
                    {group.jobs.map((job) => (
                      <Card
                        key={job._id}
                        onClick={() => setSelectedJobId(job._id)}
                        onContextMenu={(e) => handleContextMenu(e, job)}
                        sx={{
                          borderLeft: '3px solid #43A047',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                            transform: 'translateY(-1px)',
                          },
                        }}
                      >
                        <Box sx={{ p: 1.25 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 600,
                              mb: 0.25,
                              lineHeight: 1.3,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {job.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                            {job.customerId?.name || 'Unknown Customer'}
                          </Typography>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.75 }}>
                            <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>
                              {hideSensitive ? 'Locked' : formatCurrency(job.valueContracted || job.valueEstimated)}
                            </Typography>
                            <Chip
                              label="Done"
                              size="small"
                              sx={{
                                height: 18,
                                backgroundColor: theme.palette.mode === 'dark' ? 'rgba(67, 160, 71, 0.3)' : '#43A04715',
                                color: 'success.main',
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                '& .MuiChip-label': { px: 0.75 },
                              }}
                            />
                          </Box>
                        </Box>
                      </Card>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        )}

        {/* Job Detail Modal */}
        <JobDetailModal
          jobId={selectedJobId}
          open={!!selectedJobId}
          onClose={() => setSelectedJobId(null)}
          onJobUpdate={handleJobUpdate}
          onJobDataChanged={handleJobDataChanged}
          onJobDelete={handleJobDelete}
          onJobArchive={handleJobArchive}
          hideSensitive={hideSensitive}
        />
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
          <MenuItem onClick={openCloseDateDialog}>
            <ListItemIcon>
              <EditCalendarIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit Close Date</ListItemText>
          </MenuItem>
          <MenuItem onClick={openReopenDialog}>
            <ListItemIcon>
              <RestoreIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Return to pipeline"
              secondary="Undo close-out; move to Installed for payment tracking"
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </MenuItem>
        </Menu>
        <Dialog
          open={closeDateDialogOpen}
          onClose={() => {
            if (savingCloseDate) return;
            setCloseDateDialogOpen(false);
            setEditingCloseDateJob(null);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Edit Close Date</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              margin="dense"
              label="Close date"
              type="date"
              value={closeDateInput}
              onChange={(e) => setCloseDateInput(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setCloseDateDialogOpen(false);
                setEditingCloseDateJob(null);
              }}
              disabled={savingCloseDate}
            >
              Cancel
            </Button>
            <Button variant="contained" onClick={handleSaveCloseDate} disabled={savingCloseDate}>
              {savingCloseDate ? 'Saving...' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={reopenDialogOpen}
          onClose={() => {
            if (reopening) return;
            setReopenDialogOpen(false);
            setReopenJob(null);
          }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Return job to pipeline?</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              This removes the job from Completed Jobs and sets the stage to <strong>Installed</strong> so you
              can track final payment on the board. Close-out flags are cleared.
            </Typography>
            {reopenJob && (
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {reopenJob.title}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setReopenDialogOpen(false);
                setReopenJob(null);
              }}
              disabled={reopening}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleConfirmReopenFromCompleted}
              disabled={reopening}
            >
              {reopening ? 'Working…' : 'Return to pipeline'}
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Box>
  );
}

export default CompletedJobsPage;

