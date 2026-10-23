/**
 * PipelinePage — Kanban pipeline board (main job workflow UI).
 * Routes: /pipeline, /pipeline-view (TV mode)
 * APIs: GET /jobs, POST /jobs/:id/move-stage
 * Docs: ../../../docs/PAGES.md#pipelinepagetsx
 */
// @ts-nocheck — large page; tighten types incrementally
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Container,
  Box,
  CircularProgress,
  Paper,
  IconButton,
  Button,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  TextField,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Archive as ArchiveIcon,
} from '@mui/icons-material';
import axios from 'axios';
import toast from 'react-hot-toast';
import PipelineBoard from '../components/pipeline/PipelineBoard';
import JobDetailModal, { JOB_MODAL_TAB } from '../components/jobs/JobDetailModal';
import AppointmentList from '../components/appointments/AppointmentList';
import AddAppointmentModal from '../components/appointments/AddAppointmentModal';
import TodoList from '../components/todos/TodoList';
import AddTodoModal from '../components/todos/AddTodoModal';
import JobContextMenu from '../components/jobs/JobContextMenu';
import AddJobTaskModal from '../components/jobs/AddJobTaskModal';
import AddJobModal from '../components/jobs/AddJobModal';
import PipelineStageSmsDialog from '../components/pipeline/PipelineStageSmsDialog';
import { useAuth } from '../context/AuthContext';
import { fetchPipelineLayoutsList, createPipelineLayout } from '../utils/pipelineLayoutsApi';
import { fetchPipelineSmsTemplates, findTemplateForStage } from '../utils/pipelineSmsTemplates';
import { useSocketSubscription } from '../hooks/useSocketSubscription';
import { useIsMobile } from '../hooks/useIsMobile';
import { useShopViewSensitive } from '../hooks/useShopViewSensitive';
import { useFinancialPinLockContext } from '../context/FinancialPinLockContext';
import { getConnectedSocketId, getTenantRoom } from '../services/socket';
import { applyJobRealtimeToList, isActivePipelineJob } from '../utils/realtimeJobs';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const PIPELINE_SELECTION_KEY_PREFIX = 'pipelineSelectedLayoutV1';

function getPipelineSelectionStorageKey(tenantId) {
  const raw =
    tenantId && typeof tenantId === 'object'
      ? tenantId._id ?? tenantId.id
      : tenantId ?? localStorage.getItem('tenantId');
  const id = String(raw ?? '').trim();
  if (/^[a-fA-F0-9]{24}$/.test(id)) return `${PIPELINE_SELECTION_KEY_PREFIX}_${id}`;
  return `${PIPELINE_SELECTION_KEY_PREFIX}_unknown`;
}

function PipelinePage({ tvMode = false, externalViewControls = false }) {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user, canModifyPipeline, tenantIdForBranding } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [jobModalInitialTab, setJobModalInitialTab] = useState(JOB_MODAL_TAB.overview);
  const [jobModalStartEditing, setJobModalStartEditing] = useState(false);
  const [addAppointmentOpen, setAddAppointmentOpen] = useState(false);
  const [editAppointmentOpen, setEditAppointmentOpen] = useState(false);
  const [editingAppointmentId, setEditingAppointmentId] = useState(null);
  const [appointmentRefreshTrigger, setAppointmentRefreshTrigger] = useState(0);
  const [addTodoOpen, setAddTodoOpen] = useState(false);
  const [editTodoOpen, setEditTodoOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState(null);
  const [todoRefreshTrigger, setTodoRefreshTrigger] = useState(0);
  const [contextMenuAnchor, setContextMenuAnchor] = useState(null);
  const [contextMenuJob, setContextMenuJob] = useState(null);
  const [addJobTaskOpen, setAddJobTaskOpen] = useState(false);
  const [selectedJobForTask, setSelectedJobForTask] = useState(null);
  const [moveStageOpen, setMoveStageOpen] = useState(false);
  const [selectedJobForMove, setSelectedJobForMove] = useState(null);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [appointmentsCollapsed, setAppointmentsCollapsed] = useState(false);
  const [tasksCount, setTasksCount] = useState(0);
  const [appointmentsCount, setAppointmentsCount] = useState(0);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pipelineLayouts, setPipelineLayouts] = useState([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState('default');
  const [pipelineHydrated, setPipelineHydrated] = useState(false);
  const [pipelineSmsTemplates, setPipelineSmsTemplates] = useState([]);
  const [stageSmsPrompt, setStageSmsPrompt] = useState(null);
  const { isShopViewRole, hideSensitive: shopHideSensitive } = useShopViewSensitive(user?.role);
  const financialPin = useFinancialPinLockContext();
  const hideSensitive = shopHideSensitive || financialPin.hideFinancials;

  // Phones show the board only — tasks and appointments live on the desktop pipeline.
  const showTasksAndAppointments = !isShopViewRole && !tvMode && !isMobile;


  const autoMoveDeadEstimates = async () => {
    try {
      await axios.post(`${API_URL}/jobs/dead-estimates/auto-move`);
    } catch (error) {
      console.error('Error auto-moving dead estimates:', error);
    }
  };

  // Fetch jobs from backend
  useEffect(() => {
    const initialize = async () => {
      // First, auto-move any dead estimates
      await autoMoveDeadEstimates();
      // Then fetch the updated jobs list
      await fetchJobs();
    };
    initialize();
  }, []);

  const refreshPipelineLayouts = useCallback(async () => {
    try {
      const list = await fetchPipelineLayoutsList(API_URL);
      setPipelineLayouts(list);
      return list;
    } catch (error) {
      const status = error.response?.status;
      console.error('Error loading pipeline layouts:', error);
      if (status === 404) {
        toast.error(
          'Custom pipelines are not available on this server yet. Deploy the latest API (includes GET /pipeline-layouts).'
        );
      }
      setPipelineLayouts([]);
      return [];
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setPipelineHydrated(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const list = await refreshPipelineLayouts();
      if (cancelled) return;
      const key = getPipelineSelectionStorageKey(user.tenantId);
      let saved = 'default';
      try {
        saved = localStorage.getItem(key) || 'default';
      } catch {
        saved = 'default';
      }
      if (saved !== 'default' && list.some((l) => String(l._id) === saved)) {
        setSelectedPipelineId(saved);
      } else {
        setSelectedPipelineId('default');
      }
      setPipelineHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, refreshPipelineLayouts]);

  useEffect(() => {
    if (!user || !pipelineHydrated) return;
    const key = getPipelineSelectionStorageKey(user.tenantId);
    try {
      localStorage.setItem(key, selectedPipelineId);
    } catch {
      /* ignore */
    }
  }, [user, selectedPipelineId, pipelineHydrated]);

  useEffect(() => {
    if (selectedPipelineId === 'default') return;
    if (!pipelineLayouts.length) return;
    const exists = pipelineLayouts.some((l) => String(l._id) === selectedPipelineId);
    if (!exists) setSelectedPipelineId('default');
  }, [pipelineLayouts, selectedPipelineId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const templates = await fetchPipelineSmsTemplates();
        if (!cancelled) setPipelineSmsTemplates(templates);
      } catch {
        if (!cancelled) setPipelineSmsTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Check for jobId in URL query params and open that job's modal
  useEffect(() => {
    const jobIdFromUrl = searchParams.get('jobId');
    if (!jobIdFromUrl) return;
    setSelectedJobId(jobIdFromUrl);
    const next = new URLSearchParams(searchParams);
    next.delete('jobId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  /** Paginate through GET /jobs until all active pipeline cards are loaded. */
  const fetchJobs = useCallback(async ({ background = false } = {}) => {
    try {
      if (!background) {
        setLoading(true);
      }

      const pageSize = 200;
      let page = 1;
      let totalPages = 1;
      const allJobs = [];

      do {
        const response = await axios.get(`${API_URL}/jobs`, {
          params: { page, limit: pageSize },
        });
        const batch = response.data.jobs || response.data || [];
        if (Array.isArray(batch)) {
          allJobs.push(...batch);
        }
        totalPages = Number(response.data.totalPages) || 1;
        page += 1;
      } while (page <= totalPages);

      setJobs(allJobs);
    } catch (error) {
      console.error('Error fetching jobs:', error);
      console.error('Error response:', error.response?.data);
      toast.error('Failed to load jobs');
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, []);

  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const handleRealtimeProjectUpdate = useCallback((payload) => {
    const sourceSocketId = payload?.sourceSocketId || null;
    const ownSocketId = getConnectedSocketId();
    if (sourceSocketId && ownSocketId && sourceSocketId === ownSocketId) return;
    setJobs((prev) => applyJobRealtimeToList(prev, payload, isActivePipelineJob));
  }, []);
  const handleRealtimeTaskUpdate = useCallback((payload) => {
    const sourceSocketId = payload?.sourceSocketId || null;
    const ownSocketId = getConnectedSocketId();
    if (sourceSocketId && ownSocketId && sourceSocketId === ownSocketId) return;
    setTodoRefreshTrigger((prev) => prev + 1);
  }, []);
  const handleRealtimeAppointmentChange = useCallback((payload) => {
    const sourceSocketId = payload?.sourceSocketId || null;
    const ownSocketId = getConnectedSocketId();
    if (sourceSocketId && ownSocketId && sourceSocketId === ownSocketId) return;
    setAppointmentRefreshTrigger((prev) => prev + 1);
  }, []);
  useSocketSubscription(tenantRoom, 'project.updated', handleRealtimeProjectUpdate);
  useSocketSubscription(tenantRoom, 'project.created', handleRealtimeProjectUpdate);
  useSocketSubscription(tenantRoom, 'task.updated', handleRealtimeTaskUpdate);
  useSocketSubscription(tenantRoom, 'task.created', handleRealtimeTaskUpdate);
  useSocketSubscription(tenantRoom, 'appointment.changed', handleRealtimeAppointmentChange);

  const handleJobUpdate = async (jobId, updates) => {
    try {
      await axios.patch(`${API_URL}/jobs/${jobId}`, updates);
      toast.success('Job updated');
      fetchJobs(); // Refresh
    } catch (error) {
      console.error('Error updating job:', error);
      toast.error('Failed to update job');
    }
  };

  const handleStageChange = async (jobId, toStage, note) => {
    // POST move-stage logs activity + stage-change note on the server
    const previousJobs = jobs;
    setJobs((prev) =>
      prev.map((job) => (String(job?._id) === String(jobId) ? { ...job, stage: toStage } : job))
    );
    try {
      const response = await axios.post(`${API_URL}/jobs/${jobId}/move-stage`, { toStage, note });
      const updated = response?.data;
      if (updated?._id) {
        setJobs((prev) =>
          prev.map((job) => (String(job?._id) === String(updated._id) ? { ...job, ...updated } : job))
        );
      }
      toast.success('Job moved to ' + toStage.replace(/_/g, ' '));
      if (!tvMode) {
        let templates = pipelineSmsTemplates;
        try {
          templates = await fetchPipelineSmsTemplates();
          setPipelineSmsTemplates(templates);
        } catch {
          /* use cached templates */
        }
        const template = findTemplateForStage(templates, toStage);
        if (template) {
          const jobForSms =
            updated?._id
              ? updated
              : previousJobs.find((job) => String(job?._id) === String(jobId)) || null;
          setStageSmsPrompt({
            job: jobForSms ? { ...jobForSms, stage: toStage } : null,
            stage: toStage,
            template,
          });
        }
      }
    } catch (error) {
      setJobs(previousJobs);
      console.error('Error moving job:', error);
      toast.error('Failed to move job');
    }
  };

  const handleJobDelete = async (jobId) => {
    await fetchJobs(); // Refresh the list
  };

  const handleJobArchive = async (jobId) => {
    await fetchJobs(); // Refresh the list
  };

  const handleJobDataChanged = useCallback(({ type }) => {
    if (type === 'task') {
      setTodoRefreshTrigger((prev) => prev + 1);
    }
    if (type === 'appointment') {
      setAppointmentRefreshTrigger((prev) => prev + 1);
    }
    fetchJobs({ background: true });
  }, [fetchJobs]);

  const handleArchiveCompleted = async () => {
    try {
      setArchiving(true);
      const response = await axios.post(`${API_URL}/jobs/archive-completed`);
      const archivedCount = Number(response.data?.archived || 0);

      if (archivedCount > 0) {
        toast.success(`Closed out ${archivedCount} completed job(s)`);
      } else {
        toast('No completed jobs to close out');
      }

      await fetchJobs();
      setArchiveDialogOpen(false);
    } catch (error) {
      console.error('Error closing out completed jobs:', error);
      toast.error(error.response?.data?.error || 'Failed to close out completed jobs');
    } finally {
      setArchiving(false);
    }
  };

  // Phones always show the default board — custom layouts stay a desktop tool. The saved
  // selection is left untouched so desktop still opens whatever the user last picked.
  const effectivePipelineId = isMobile ? 'default' : selectedPipelineId;

  const layoutFilteredJobs = useMemo(() => {
    if (effectivePipelineId === 'default') {
      return jobs.filter((j) => !j.pipelineLayoutId);
    }
    return jobs.filter((j) => String(j.pipelineLayoutId || '') === effectivePipelineId);
  }, [jobs, effectivePipelineId]);

  const filteredJobs = layoutFilteredJobs;

  const pipelineOptions = useMemo(
    () => [
      { id: 'default', label: 'Default' },
      ...pipelineLayouts.map((l) => ({
        id: String(l._id),
        label: l.title || 'Untitled pipeline',
      })),
    ],
    [pipelineLayouts]
  );

  const activeCustomLayout = useMemo(() => {
    if (effectivePipelineId === 'default') return null;
    return pipelineLayouts.find((l) => String(l._id) === effectivePipelineId) || null;
  }, [pipelineLayouts, effectivePipelineId]);

  const pipelineMode = effectivePipelineId === 'default' ? 'default' : 'custom';

  const selectedCustomInitialStage = useMemo(() => {
    if (!activeCustomLayout?.levels?.length) return null;
    const sorted = [...activeCustomLayout.levels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const lvl of sorted) {
      const stage = (lvl.stageKeys || []).find((k) => String(k || '').trim());
      if (stage) return String(stage).trim();
    }
    return null;
  }, [activeCustomLayout]);

  const handleCreateEmptyPipeline = async () => {
    if (!canModifyPipeline()) {
      toast.error('You do not have permission to create pipelines');
      return;
    }
    const confirmed = window.confirm('Are you sure you want to create a new pipeline?');
    if (!confirmed) return;
    try {
      const res = await createPipelineLayout(API_URL, { title: 'New pipeline' });
      const data = res.data;
      await refreshPipelineLayouts();
      setSelectedPipelineId(String(data._id));
      toast.success('New pipeline created — use Edit to add stages');
    } catch (error) {
      const msg = error.response?.data?.error || error.message || 'Failed to create pipeline';
      toast.error(msg);
    }
  };

  const handleCustomLayoutDeleted = async (deletedId) => {
    await refreshPipelineLayouts();
    if (String(selectedPipelineId) === String(deletedId)) {
      setSelectedPipelineId('default');
    }
  };

  // Count jobs in FINAL_PAYMENT_CLOSED stage (respecting search filter)
  const completedJobsCount = filteredJobs.filter(
    job => job.stage === 'FINAL_PAYMENT_CLOSED' && !job.isArchived && !job.isDeadEstimate
  ).length;

  return (
    <Box sx={{ minHeight: tvMode ? '100vh' : undefined }}>
      {/* Main Content */}
      <Container
        maxWidth="xl"
        sx={{
          py: tvMode ? { xs: 1, sm: 1.5 } : { xs: 1.5, sm: 2 },
          px: { xs: 1, sm: 2 },
        }}
      >
        {tvMode && !externalViewControls && (
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
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
              variant="outlined"
              size="small"
              onClick={() => navigate('/customers-view')}
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            >
              Customers view
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                navigate('/pipeline');
              }}
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            >
              Exit Pipeline view
            </Button>
          </Box>
        )}

        {/* Todos and Appointments — hidden in shop view or fullscreen pipeline view */}
        {showTasksAndAppointments && (
        <Box sx={{ mb: { xs: 2, sm: 4 } }}>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: { xs: 2, sm: 3 } }}>
            {/* Todos Section */}
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Tasks / Todos ({tasksCount})
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => setTasksCollapsed(!tasksCollapsed)}
                  sx={{ ml: 1 }}
                >
                  {tasksCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
                </IconButton>
              </Box>
              {tasksCollapsed ? (
                <Paper
                  elevation={0}
                  onClick={() => setTasksCollapsed(false)}
                  sx={{
                    borderRadius: '16px',
                    p: { xs: 1.5, sm: 3 },
                    boxShadow: theme.palette.mode === 'dark'
                      ? '0 2px 12px rgba(0, 0, 0, 0.3)'
                      : '0 2px 12px rgba(0, 0, 0, 0.06)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    '&:hover': {
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
                    },
                  }}
                >
                  <Typography
                    variant="body1"
                    sx={{ color: 'primary.main', fontWeight: 600 }}
                  >
                    View all ({tasksCount}) {tasksCount === 1 ? 'task' : 'tasks'}
                  </Typography>
                </Paper>
              ) : (
                <Paper
                  elevation={0}
                  sx={{
                    borderRadius: '16px',
                    p: 3,
                    boxShadow: theme.palette.mode === 'dark'
                      ? '0 2px 12px rgba(0, 0, 0, 0.3)'
                      : '0 2px 12px rgba(0, 0, 0, 0.06)',
                  }}
                >
                  <TodoList
                    jobs={jobs}
                    onTodoClick={(id, taskData) => {
                      setEditingTodo({
                        id,
                        data: {
                          title: taskData.title,
                          description: taskData.description,
                        },
                      });
                      setEditTodoOpen(true);
                    }}
                    onTodoComplete={() => {
                      setTodoRefreshTrigger(prev => prev + 1);
                    }}
                    onAddClick={() => setAddTodoOpen(true)}
                    onCountChange={setTasksCount}
                    refreshTrigger={todoRefreshTrigger}
                  />
                </Paper>
              )}
            </Box>

            {/* Appointments Section */}
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Appointments ({appointmentsCount})
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => setAppointmentsCollapsed(!appointmentsCollapsed)}
                  sx={{ ml: 1 }}
                >
                  {appointmentsCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
                </IconButton>
              </Box>
              {appointmentsCollapsed ? (
                <Paper
                  elevation={0}
                  onClick={() => setAppointmentsCollapsed(false)}
                  sx={{
                    borderRadius: '16px',
                    p: { xs: 1.5, sm: 3 },
                    boxShadow: theme.palette.mode === 'dark'
                      ? '0 2px 12px rgba(0, 0, 0, 0.3)'
                      : '0 2px 12px rgba(0, 0, 0, 0.06)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    '&:hover': {
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
                    },
                  }}
                >
                  <Typography
                    variant="body1"
                    sx={{ color: 'primary.main', fontWeight: 600 }}
                  >
                    View all ({appointmentsCount}) {appointmentsCount === 1 ? 'appointment' : 'appointments'}
                  </Typography>
                </Paper>
              ) : (
                <Paper
                  elevation={0}
                  sx={{
                    borderRadius: '16px',
                    p: 3,
                    boxShadow: theme.palette.mode === 'dark'
                      ? '0 2px 12px rgba(0, 0, 0, 0.3)'
                      : '0 2px 12px rgba(0, 0, 0, 0.06)',
                  }}
                >
                  <AppointmentList
                    onAppointmentClick={(id) => {
                      setEditingAppointmentId(id);
                      setEditAppointmentOpen(true);
                    }}
                    onAppointmentComplete={() => {
                      // Refresh if needed
                      setAppointmentRefreshTrigger(prev => prev + 1);
                    }}
                    onAddClick={() => setAddAppointmentOpen(true)}
                    onCountChange={setAppointmentsCount}
                    refreshTrigger={appointmentRefreshTrigger}
                  />
                </Paper>
              )}
            </Box>
          </Box>
        </Box>
        )}

        {/* Pipeline Board */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <PipelineBoard
            jobs={filteredJobs}
            onJobUpdate={handleJobUpdate}
            onStageChange={handleStageChange}
            onJobClick={(jobId) => {
              setJobModalInitialTab(JOB_MODAL_TAB.overview);
              setJobModalStartEditing(false);
              setSelectedJobId(jobId);
            }}
            onMapErrorClick={(job) => {
              setJobModalInitialTab(JOB_MODAL_TAB.overview);
              setJobModalStartEditing(true);
              setSelectedJobId(job._id);
            }}
            onNewJobClick={() => {
              setAddJobOpen(true);
            }}
            onJobContextMenu={(e, job) => {
              setContextMenuAnchor(e.currentTarget);
              setContextMenuJob(job);
            }}
            onArchiveCompleted={() => setArchiveDialogOpen(true)}
            completedJobsCount={completedJobsCount}
            pipelineMode={pipelineMode}
            activeCustomLayout={activeCustomLayout}
            pipelineSelectorValue={selectedPipelineId}
            pipelineOptions={pipelineOptions}
            onPipelineSelectChange={setSelectedPipelineId}
            onCreateEmptyPipeline={handleCreateEmptyPipeline}
            onCustomLayoutSaved={refreshPipelineLayouts}
            onCustomLayoutDeleted={handleCustomLayoutDeleted}
            hideSensitive={hideSensitive}
            onRequestSensitiveUnlock={financialPin.openUnlockDialog}
          />
        )}

        {/* Job Detail Modal */}
        <JobDetailModal
          jobId={selectedJobId}
          open={!!selectedJobId}
          initialTab={jobModalInitialTab}
          startEditing={jobModalStartEditing}
          onClose={() => {
            setSelectedJobId(null);
            setJobModalInitialTab(JOB_MODAL_TAB.overview);
            setJobModalStartEditing(false);
          }}
          onJobUpdate={handleJobUpdate}
          onJobDelete={handleJobDelete}
          onJobArchive={handleJobArchive}
          onAppointmentCreated={() => {
            // Trigger refresh of appointment list
            setAppointmentRefreshTrigger(prev => prev + 1);
          }}
          onJobDataChanged={handleJobDataChanged}
          hideSensitive={hideSensitive}
          onRequestSensitiveUnlock={financialPin.openUnlockDialog}
          shopDisplayMode={tvMode}
        />

        {/* Add Appointment Modal */}
        <AddAppointmentModal
          open={addAppointmentOpen}
          onClose={() => setAddAppointmentOpen(false)}
          onSuccess={() => {
            // Trigger refresh of appointment list
            setAppointmentRefreshTrigger(prev => prev + 1);
          }}
        />

        {/* Edit Appointment Modal */}
        <AddAppointmentModal
          open={editAppointmentOpen}
          onClose={() => {
            setEditAppointmentOpen(false);
            setEditingAppointmentId(null);
          }}
          onSuccess={() => {
            // Trigger refresh of appointment list
            setAppointmentRefreshTrigger(prev => prev + 1);
            setEditAppointmentOpen(false);
            setEditingAppointmentId(null);
          }}
          appointmentId={editingAppointmentId}
        />

        {/* Add Todo Modal */}
        <AddTodoModal
          open={addTodoOpen}
          onClose={() => setAddTodoOpen(false)}
          onSuccess={() => {
            // Trigger refresh of todo list
            setTodoRefreshTrigger(prev => prev + 1);
          }}
        />

        {/* Edit Todo Modal */}
        <AddTodoModal
          open={editTodoOpen}
          onClose={() => {
            setEditTodoOpen(false);
            setEditingTodo(null);
          }}
          onSuccess={() => {
            // Trigger refresh of todo list
            setTodoRefreshTrigger(prev => prev + 1);
            setEditingTodo(null);
          }}
          taskId={editingTodo?.id}
          initialData={editingTodo?.data}
        />

        {/* Job Context Menu */}
        <JobContextMenu
          anchorEl={contextMenuAnchor}
          open={!!contextMenuAnchor}
          onClose={() => {
            setContextMenuAnchor(null);
            setContextMenuJob(null);
          }}
          onMoveStage={() => {
            if (contextMenuJob) {
              setSelectedJobForMove(contextMenuJob);
              setMoveStageOpen(true);
            }
          }}
          onAddTask={() => {
            if (contextMenuJob) {
              setSelectedJobForTask(contextMenuJob);
              setAddJobTaskOpen(true);
            }
          }}
          onEditPayments={() => {
            if (contextMenuJob?._id) {
              setJobModalInitialTab(JOB_MODAL_TAB.payments);
              setJobModalStartEditing(false);
              setSelectedJobId(contextMenuJob._id);
            }
          }}
          onArchive={async () => {
            const jobId = contextMenuJob?._id;
            if (!jobId) return;
            try {
              await axios.post(`${API_URL}/jobs/${jobId}/archive`);
              toast.success('Job archived successfully');
              if (selectedJobId === jobId) {
                setSelectedJobId(null);
              }
              fetchJobs();
            } catch (error) {
              console.error('Error archiving job:', error);
              toast.error(error.response?.data?.error || 'Failed to archive job');
            }
          }}
          job={contextMenuJob}
        />

        {/* Add Job Task Modal */}
        <AddJobTaskModal
          open={addJobTaskOpen}
          onClose={() => {
            setAddJobTaskOpen(false);
            setSelectedJobForTask(null);
          }}
          onSuccess={() => {
            setTodoRefreshTrigger(prev => prev + 1);
            fetchJobs(); // Refresh jobs to show updated activities
          }}
          job={selectedJobForTask}
        />

        {/* Move Stage Modal - Reuse JobDetailModal or create simple stage selector */}
        {moveStageOpen && selectedJobForMove && (
          <JobDetailModal
            jobId={selectedJobForMove._id}
            open={moveStageOpen}
            onClose={() => {
              setMoveStageOpen(false);
              setSelectedJobForMove(null);
            }}
            onJobUpdate={handleJobUpdate}
            onJobDelete={handleJobDelete}
            onJobArchive={handleJobArchive}
            onJobDataChanged={handleJobDataChanged}
            hideSensitive={hideSensitive}
            onRequestSensitiveUnlock={financialPin.openUnlockDialog}
            shopDisplayMode={tvMode}
          />
        )}

        {/* Add Job Modal */}
        <AddJobModal
          open={addJobOpen}
          onClose={() => {
            setAddJobOpen(false);
          }}
          onJobCreated={(newJob) => {
            // Refresh jobs list to show the new job
            fetchJobs();
          }}
          pipelineLayoutId={selectedPipelineId === 'default' ? null : selectedPipelineId}
          initialStage={selectedPipelineId === 'default' ? null : selectedCustomInitialStage}
        />

        <PipelineStageSmsDialog
          open={Boolean(stageSmsPrompt)}
          job={stageSmsPrompt?.job || null}
          stage={stageSmsPrompt?.stage || ''}
          template={stageSmsPrompt?.template || null}
          senderName={user?.name || ''}
          companyName={
            user?.tenantId && typeof user.tenantId === 'object' && user.tenantId.name
              ? String(user.tenantId.name)
              : 'San Clemente Woodworking'
          }
          onClose={() => setStageSmsPrompt(null)}
        />

        {/* Close Out Completed Jobs Dialog */}
        <Dialog open={archiveDialogOpen} onClose={() => !archiving && setArchiveDialogOpen(false)}>
          <DialogTitle>Close Out Completed Jobs</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Are you sure you want to close out all {completedJobsCount} job(s) in the "Final Payment Closed" stage?
              These jobs will be removed from the active pipeline. You can still see their history on the Completed Jobs page.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setArchiveDialogOpen(false)} disabled={archiving}>
              Cancel
            </Button>
            <Button 
              onClick={handleArchiveCompleted} 
              color="success" 
              variant="contained"
              disabled={archiving}
              startIcon={<ArchiveIcon />}
            >
              {archiving ? 'Closing...' : `Close Out ${completedJobsCount} Job(s)`}
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Box>
  );
}

export default PipelinePage;