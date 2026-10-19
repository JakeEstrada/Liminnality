import { useMemo, useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Paper,
  Button,
  IconButton,
  Tooltip,
  useTheme,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Autocomplete,
  alpha,
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  Search as SearchIcon,
  History as HistoryIcon,
  Edit as EditIcon,
  Lock as LockIcon,
  InfoOutlined as InfoOutlinedIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import JobCard from './JobCard';
import { useIsMobile } from '../../hooks/useIsMobile';
import { updatePipelineLayout, deletePipelineLayout } from '../../utils/pipelineLayoutsApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/**
 * Phones render the board at real font sizes in very narrow columns rather than
 * CSS-zooming it down — scaling text below ~8px makes glyphs collide. Columns share
 * the width evenly and only scroll once a phase has more stages than this floor allows.
 */
const MOBILE_COLUMN_MIN_WIDTH = 72;

const STAGE_LABELS = {
  APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
  ESTIMATE_IN_PROGRESS: 'Estimate Current, first 5 days',
  ESTIMATE_SENT: 'Estimate Sent',
  ENGAGED_DESIGN_REVIEW: 'Design Review',
  CONTRACT_OUT: 'Contract Out',
  CONTRACT_SIGNED: 'Contract Signed', // Kept for backward compatibility but not shown
  DEPOSIT_PENDING: 'Signed / Deposit Pending',
  JOB_PREP: 'Job Prep',
  TAKEOFF_COMPLETE: 'Fabrication',
  READY_TO_SCHEDULE: 'Ready to Schedule',
  SCHEDULED: 'Scheduled',
  IN_PRODUCTION: 'In Production',
  INSTALLED: 'Installed',
  FINAL_PAYMENT_CLOSED: 'Final Payment Closed',
};

// Phase groupings
const APPOINTMENTS_PHASE = [
  'APPOINTMENT_SCHEDULED',
];

const SALES_PHASE = [
  'ESTIMATE_IN_PROGRESS',
  'ESTIMATE_SENT',
  'ENGAGED_DESIGN_REVIEW',
  'CONTRACT_OUT',
];

const JOB_READINESS_PHASE = [
  'DEPOSIT_PENDING',
  'JOB_PREP',
  'TAKEOFF_COMPLETE',
  'READY_TO_SCHEDULE',
];

const EXECUTION_PHASE = [
  'SCHEDULED',
  'IN_PRODUCTION',
  'INSTALLED',
  'FINAL_PAYMENT_CLOSED',
];

const STAGE_NAME_SUGGESTIONS = Object.values(STAGE_LABELS);

/** Compact stage total. Keeps sub-$1K columns readable instead of collapsing them to "$0K". */
function formatStageValue(value) {
  const n = Number(value) || 0;
  if (n <= 0) return '$0';
  if (n < 1000) return `$${Math.round(n)}`;
  if (n < 10000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  if (n < 1000000) return `$${Math.round(n / 1000)}K`;
  return `$${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
}

const LEGACY_PIPELINE_STAGE_CONFIG_KEY = 'pipelineStageConfigV1';

/** Per-tenant localStorage key so stage labels/hidden flags never leak across organizations. */
function getPipelineStageConfigStorageKey(tenantId) {
  if (tenantId == null) return `${LEGACY_PIPELINE_STAGE_CONFIG_KEY}_unknown`;
  const raw =
    typeof tenantId === 'object' && tenantId !== null
      ? tenantId._id ?? tenantId.id
      : tenantId;
  const id = String(raw).trim();
  if (/^[a-fA-F0-9]{24}$/.test(id)) return `${LEGACY_PIPELINE_STAGE_CONFIG_KEY}_${id}`;
  return `${LEGACY_PIPELINE_STAGE_CONFIG_KEY}_unknown`;
}

function PipelineBoard({
  jobs,
  onJobUpdate,
  onStageChange,
  onJobClick,
  onMapErrorClick,
  onNewJobClick,
  onJobContextMenu,
  onArchiveCompleted,
  completedJobsCount,
  search = '',
  onSearchChange,
  pipelineMode = 'default',
  activeCustomLayout = null,
  pipelineSelectorValue = 'default',
  pipelineOptions = [],
  onPipelineSelectChange,
  onCreateEmptyPipeline,
  onCustomLayoutSaved,
  onCustomLayoutDeleted,
  hideSensitive = false,
  onRequestSensitiveUnlock,
}) {
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, canModifyPipeline } = useAuth();
  const [draggedOverStage, setDraggedOverStage] = useState(null);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState(null);
  const [savingLayout, setSavingLayout] = useState(false);

  const pipelineStageConfigKey = useMemo(
    () => getPipelineStageConfigStorageKey(user?.tenantId),
    [user?.tenantId]
  );

  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [stageOverrides, setStageOverrides] = useState({});
  const [stageDescriptionEdit, setStageDescriptionEdit] = useState(null);
  const [savingStageDescription, setSavingStageDescription] = useState(false);

  /** Server is source of truth per tenant; localStorage is fallback if API fails or old deploy. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadLocalFallback = () => {
      try {
        let stored = localStorage.getItem(pipelineStageConfigKey);
        if (!stored) stored = localStorage.getItem(LEGACY_PIPELINE_STAGE_CONFIG_KEY);
        if (!stored) return {};
        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    };

    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}/tenants/pipeline-settings`);
        if (cancelled) return;
        const o = data?.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides) ? data.overrides : {};
        setStageOverrides(o);
      } catch {
        if (!cancelled) setStageOverrides(loadLocalFallback());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, pipelineStageConfigKey]);

  const { jobsByStage, stageTotals } = useMemo(() => {
    const byStage = {};
    const totals = {};
    let stageIds = [];

    if (pipelineMode === 'custom' && activeCustomLayout?.levels?.length) {
      const seen = new Set();
      [...activeCustomLayout.levels]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .forEach((lvl) => {
          (lvl.stageKeys || []).forEach((k) => {
            if (k && !seen.has(k)) {
              seen.add(k);
              stageIds.push(k);
            }
          });
        });
    } else {
      stageIds = [...APPOINTMENTS_PHASE, ...SALES_PHASE, ...JOB_READINESS_PHASE, ...EXECUTION_PHASE];
    }

    stageIds.forEach((stageId) => {
      const stageJobs = jobs.filter((job) => job.stage === stageId && !job.isArchived);
      byStage[stageId] = stageJobs;
      totals[stageId] = {
        count: stageJobs.length,
        value: stageJobs.reduce((sum, job) => sum + (job.valueEstimated || 0), 0),
      };
    });

    return { jobsByStage: byStage, stageTotals: totals };
  }, [jobs, pipelineMode, activeCustomLayout]);

  const shownStages = useMemo(() => [...SALES_PHASE, ...JOB_READINESS_PHASE, ...EXECUTION_PHASE], []);
  const getStageOverride = (stageId) => stageOverrides?.[stageId] || {};
  const isStageHidden = (stageId) => !!getStageOverride(stageId)?.hidden;
  const getStageLabel = (stageId) => {
    const override = getStageOverride(stageId);
    if (override?.label && String(override.label).trim()) return String(override.label).trim();
    return STAGE_LABELS[stageId] || stageId;
  };
  const getStageDescription = (stageId) => {
    const override = getStageOverride(stageId);
    if (override?.description && String(override.description).trim()) {
      return String(override.description).trim();
    }
    return '';
  };

  const saveStageDescription = async () => {
    if (!stageDescriptionEdit?.stageId || !canModifyPipeline()) return;
    const stageId = stageDescriptionEdit.stageId;
    const description = String(stageDescriptionEdit.description || '').trim();
    const nextOverrides = {
      ...stageOverrides,
      [stageId]: {
        ...(stageOverrides?.[stageId] || {}),
        description,
      },
    };
    if (!description) {
      const { description: _removed, ...rest } = nextOverrides[stageId] || {};
      if (Object.keys(rest).length) {
        nextOverrides[stageId] = rest;
      } else {
        delete nextOverrides[stageId];
      }
    }

    try {
      setSavingStageDescription(true);
      const { data } = await axios.patch(`${API_URL}/tenants/pipeline-settings`, {
        overrides: nextOverrides,
      });
      const saved =
        data?.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides)
          ? data.overrides
          : nextOverrides;
      setStageOverrides(saved);
      toast.success('Stage description saved');
      setStageDescriptionEdit(null);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to save description');
    } finally {
      setSavingStageDescription(false);
    }
  };

  const renderStageDescriptionIcon = (stageId) => {
    const description = getStageDescription(stageId);
    const hasDescription = Boolean(description);
    if (!hasDescription && !canModifyPipeline()) return null;

    const tooltipTitle = hasDescription
      ? description
      : canModifyPipeline()
        ? 'Click to add a stage description'
        : '';

    return (
      <Tooltip
        title={tooltipTitle}
        enterDelay={300}
        slotProps={{ tooltip: { sx: { maxWidth: 340, whiteSpace: 'pre-wrap' } } }}
      >
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            if (!canModifyPipeline()) return;
            setStageDescriptionEdit({
              stageId,
              description: description || '',
            });
          }}
          sx={{
            p: 0,
            width: 16,
            height: 16,
            flexShrink: 0,
            color: hasDescription ? 'info.main' : 'text.disabled',
            cursor: canModifyPipeline() ? 'pointer' : 'default',
          }}
          aria-label={`${getStageLabel(stageId)} description`}
        >
          <InfoOutlinedIcon sx={{ fontSize: '0.85rem' }} />
        </IconButton>
      </Tooltip>
    );
  };

  const handleDragOver = (e, stageId) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDraggedOverStage(stageId);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear if we're actually leaving the drop zone
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDraggedOverStage(null);
    }
  };

  const handleDrop = async (e, stageId) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggedOverStage(null);

    // Check permissions
    if (!canModifyPipeline()) {
      toast.error('You do not have permission to modify the pipeline');
      return;
    }

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      const { jobId, currentStage } = data;

      if (currentStage === stageId) {
        // Job is already in this stage, do nothing
        return;
      }

      if (onStageChange && jobId) {
        await onStageChange(jobId, stageId, `Moved via drag and drop`);
      }
    } catch (error) {
      console.error('Error handling drop:', error);
    }
  };

  // Render a single stage column
  const renderStageColumn = (stageId) => {
    const stageJobs = jobsByStage[stageId] || [];
    const { count, value } = stageTotals[stageId];
    const isDraggedOver = draggedOverStage === stageId;

    return (
      <Box
        key={stageId}
        onDragOver={canModifyPipeline() ? (e) => handleDragOver(e, stageId) : undefined}
        onDragLeave={canModifyPipeline() ? handleDragLeave : undefined}
        onDrop={canModifyPipeline() ? (e) => handleDrop(e, stageId) : undefined}
        sx={{
          minWidth: isMobile ? MOBILE_COLUMN_MIN_WIDTH : 280,
          flex: '1 1 0',
          maxWidth: '100%',
          // Border/padding stay constant so columns don't shift as a card is dragged across them.
          transition: 'background-color 0.2s ease, border-color 0.2s ease',
          backgroundColor: isDraggedOver
            ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.07)
            : 'transparent',
          borderRadius: isMobile ? 0 : '8px',
          // The drop outline is desktop-only (touch can't drag), so phones spend that space on text.
          border: isMobile ? 'none' : '2px dashed',
          borderColor: isDraggedOver ? theme.palette.primary.main : 'transparent',
          p: isMobile ? 0 : 1,
        }}
      >
        {/* Column Header */}
        <Card
          elevation={isMobile ? 0 : undefined}
          sx={{
            // Phones use a flat label bar; desktop keeps the gradient card.
            background: isMobile
              ? theme.palette.mode === 'dark'
                ? '#262B33'
                : '#E9EDF4'
              : theme.palette.mode === 'dark'
                ? 'linear-gradient(135deg, #2A2A2A 0%, #1E1E1E 100%)'
                : 'linear-gradient(135deg, #F5F7FA 0%, #E8EAF6 100%)',
            // Square panes with tight spacing keep the narrow board looking like a grid.
            borderRadius: isMobile ? 0 : '12px',
            mb: isMobile ? 0.375 : 1.5,
            boxShadow: isMobile
              ? 'none'
              : theme.palette.mode === 'dark'
                ? '0 1px 4px rgba(0, 0, 0, 0.3)'
                : '0 1px 4px rgba(0, 0, 0, 0.04)',
          }}
        >
          <CardContent sx={{ p: isMobile ? 0.75 : 1.5, '&:last-child': { pb: isMobile ? 0.75 : 1.5 } }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: isMobile ? 'center' : 'flex-start',
                gap: isMobile ? 0 : 1,
                mb: isMobile ? 0 : 0.75,
                // Fixed height on phones so every column's cards start on the same line.
                minHeight: isMobile ? 33 : undefined,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  title={getStageLabel(stageId)}
                  sx={{
                    color: theme.palette.text.secondary,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: isMobile ? 0 : '0.5px',
                    fontSize: isMobile ? '0.5625rem' : '0.75rem',
                    lineHeight: isMobile ? 1.2 : undefined,
                    minWidth: 0,
                    // Three lines fits the longest stage name ("Estimate Current, first 5 days").
                    ...(isMobile
                      ? {
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 3,
                          overflow: 'hidden',
                        }
                      : null),
                  }}
                >
                  {getStageLabel(stageId)}
                </Typography>
                {!isMobile && renderStageDescriptionIcon(stageId)}
              </Box>
              {/* Stage totals are desktop-only: phones keep the header to a plain label bar. */}
              {!isMobile && (
              <Box
                sx={{
                  flexShrink: 0,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'flex-start',
                  minWidth: 40,
                  minHeight: 18,
                }}
              >
                {hideSensitive ? (
                  <Tooltip title="Unlock stage totals">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestSensitiveUnlock?.();
                      }}
                      sx={{
                        color: theme.palette.primary.main,
                        p: 0,
                        width: 18,
                        height: 18,
                        mt: -0.125,
                      }}
                      aria-label="Unlock stage totals"
                    >
                      <LockIcon sx={{ fontSize: '0.8rem' }} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: theme.palette.primary.main,
                      lineHeight: 1.1,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatStageValue(value)}
                  </Typography>
                )}
              </Box>
              )}
            </Box>
            {/* Job count and stage shortcuts are desktop-only too. */}
            {!isMobile && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box
                sx={{
                  minWidth: 24,
                  textAlign: 'center',
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  px: 1,
                  py: 0.25,
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: count > 0 ? 'text.primary' : 'text.disabled',
                }}
              >
                {count}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                {stageId === 'ESTIMATE_SENT' && (
                  <Tooltip title="View archived estimates">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate('/archive');
                      }}
                      sx={{
                        color: theme.palette.text.secondary,
                        '&:hover': {
                          color: theme.palette.primary.main,
                          backgroundColor: theme.palette.action.hover,
                        },
                      }}
                    >
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {stageId === 'FINAL_PAYMENT_CLOSED' && completedJobsCount > 0 && onArchiveCompleted && (
                  <Tooltip title={`Close out ${completedJobsCount} completed job(s)`}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onArchiveCompleted();
                      }}
                      sx={{
                        color: theme.palette.success.main,
                        '&:hover': {
                          backgroundColor: theme.palette.mode === 'dark' 
                            ? 'rgba(67, 160, 71, 0.2)' 
                            : 'rgba(67, 160, 71, 0.1)',
                        },
                      }}
                    >
                      <CheckCircleIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
            )}
          </CardContent>
        </Card>

        {/* Job Cards */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 0.375 : 1 }}>
          {stageJobs.length > 0 ? (
            stageJobs.map((job) => (
              <JobCard
                key={job._id}
                job={job}
                onClick={() => onJobClick && onJobClick(job._id)}
                onMapErrorClick={onMapErrorClick}
                onUpdate={(updates) => onJobUpdate(job._id, updates)}
                onStageChange={(toStage, note) => onStageChange(job._id, toStage, note)}
                onContextMenu={onJobContextMenu}
                canModify={canModifyPipeline()}
                narrow={isMobile}
              />
            ))
          ) : (
            <Box
              sx={{
                py: isMobile ? 1 : 3,
                px: isMobile ? 0.25 : 1,
                textAlign: 'center',
                borderRadius: isMobile ? 0 : '8px',
                border: '1px dashed',
                borderColor: isDraggedOver ? 'primary.main' : 'divider',
                color: isDraggedOver ? 'primary.main' : 'text.disabled',
                fontSize: isMobile ? '0.5625rem' : '0.75rem',
                fontWeight: isDraggedOver ? 600 : 400,
                transition: 'color 0.2s ease, border-color 0.2s ease',
              }}
            >
              {isDraggedOver ? 'Drop here' : 'No jobs'}
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  // Render a phase section
  const renderPhase = (phaseName, phaseStages) => {
    const visibleStages = phaseStages.filter((stageId) => !isStageHidden(stageId));
    if (visibleStages.length === 0) return null;

    return (
      <Box sx={{ mb: isMobile ? 1.5 : 3 }}>
        <Typography
          variant="h6"
          sx={{
            fontSize: isMobile ? '0.8125rem' : '1rem',
            fontWeight: isMobile ? 800 : 600,
            color: theme.palette.text.primary,
            mb: isMobile ? 0.5 : 1.5,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {phaseName}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            gap: isMobile ? 0.375 : 2,
            overflowX: 'auto',
            pb: 1,
            width: '100%',
            '&::-webkit-scrollbar': {
              height: 6,
            },
            '&::-webkit-scrollbar-track': {
              background: theme.palette.mode === 'dark' ? '#2A2A2A' : '#F5F7FA',
            },
            '&::-webkit-scrollbar-thumb': {
              background: theme.palette.mode === 'dark' ? '#616161' : '#CFD8DC',
              borderRadius: '3px',
            },
          }}
        >
          {visibleStages.map(renderStageColumn)}
        </Box>
      </Box>
    );
  };

  const customHasStages =
    pipelineMode === 'custom' &&
    activeCustomLayout?.levels?.some((l) => Array.isArray(l?.stageKeys) && l.stageKeys.length > 0);

  const openLayoutEditor = () => {
    if (!activeCustomLayout) return;
    const raw = activeCustomLayout.levels || [];
    setLayoutDraft({
      _id: activeCustomLayout._id,
      title: activeCustomLayout.title || '',
      levels: JSON.parse(JSON.stringify(raw)).map((l, i) => ({
        title: l.title != null ? String(l.title) : `Level ${i + 1}`,
        order: typeof l.order === 'number' ? l.order : i,
        stageKeys: Array.isArray(l.stageKeys) ? [...l.stageKeys] : [],
      })),
    });
    setLayoutEditorOpen(true);
  };

  const saveLayoutDraft = async () => {
    if (!layoutDraft?._id) return;
    setSavingLayout(true);
    try {
      const levels = (layoutDraft.levels || []).map((l, i) => ({
        title: l.title != null ? String(l.title).trim() || `Level ${i + 1}` : `Level ${i + 1}`,
        order: i,
        stageKeys: Array.isArray(l.stageKeys) ? l.stageKeys : [],
      }));
      await updatePipelineLayout(API_URL, layoutDraft._id, {
        title: layoutDraft.title != null ? String(layoutDraft.title).trim() : '',
        levels,
      });
      toast.success('Pipeline saved');
      setLayoutEditorOpen(false);
      onCustomLayoutSaved?.();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to save pipeline';
      toast.error(msg);
    } finally {
      setSavingLayout(false);
    }
  };

  const deleteActiveLayout = async () => {
    if (!layoutDraft?._id) return;
    const confirmed = window.confirm('Are you sure you want to delete this pipeline?');
    if (!confirmed) return;
    setSavingLayout(true);
    try {
      await deletePipelineLayout(API_URL, layoutDraft._id);
      toast.success('Pipeline deleted');
      setLayoutEditorOpen(false);
      onCustomLayoutDeleted?.(layoutDraft._id);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to delete pipeline';
      toast.error(msg);
    } finally {
      setSavingLayout(false);
    }
  };

  const showPipelinePicker = Array.isArray(pipelineOptions) && pipelineOptions.length > 0 && onPipelineSelectChange;

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          borderRadius: { xs: 0, sm: '20px' },
          p: { xs: 0.75, sm: 3 },
        }}
      >
      {/* Phones are view-only on the default board, so the whole control row is desktop-only. */}
      {!isMobile && (
      <Box
        sx={{
          mb: { xs: 2, sm: 3 },
          pb: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) auto minmax(0, 1fr)' },
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifySelf: { xs: 'stretch', md: 'start' }, flexWrap: 'wrap' }}>
          {onNewJobClick && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onNewJobClick}
              sx={{
                borderRadius: '8px',
                textTransform: 'none',
              }}
            >
              New Job
            </Button>
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            flexWrap: 'wrap',
            justifySelf: { xs: 'stretch', md: 'center' },
            width: { xs: '100%', md: 'auto' },
          }}
        >
          <TextField
            size="small"
            label="Search jobs in pipeline"
            value={search}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
            sx={{ width: { xs: '100%', sm: 280 }, minWidth: 0 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          {showPipelinePicker && (
            <FormControl size="small" sx={{ minWidth: 200, maxWidth: 280 }}>
              <InputLabel id="pipeline-layout-select-label">Pipeline</InputLabel>
              <Select
                labelId="pipeline-layout-select-label"
                label="Pipeline"
                value={pipelineSelectorValue}
                onChange={(e) => onPipelineSelectChange(e.target.value)}
              >
                {pipelineOptions.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>

        <Box
          sx={{
            justifySelf: { xs: 'end', md: 'end' },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 0.5,
            flexWrap: 'wrap',
          }}
        >
          {onCreateEmptyPipeline && canModifyPipeline() && (
            <Tooltip title="New empty pipeline">
              <IconButton
                size="small"
                onClick={onCreateEmptyPipeline}
                aria-label="New empty pipeline"
                sx={{
                  border: `1px solid ${theme.palette.divider}`,
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)',
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {pipelineMode === 'custom' && canModifyPipeline() && activeCustomLayout && (
            <Tooltip title="Edit this pipeline layout">
              <IconButton
                size="small"
                onClick={openLayoutEditor}
                aria-label="Edit pipeline layout"
                sx={{
                  border: `1px solid ${theme.palette.divider}`,
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)',
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {pipelineMode === 'default' && canModifyPipeline() && (
            <Tooltip title="Customize pipeline stages">
              <IconButton
                size="small"
                onClick={() => setCustomizeOpen(true)}
                aria-label="Customize pipeline stages"
                sx={{
                  border: `1px solid ${theme.palette.divider}`,
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)',
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
              </Tooltip>
          )}
        </Box>
      </Box>
      )}

      {/* Appointments Phase - Now handled separately, not shown here */}

      {pipelineMode === 'default' && (
        <>
          {renderPhase('Sales Phase', SALES_PHASE)}
          {renderPhase('Job Readiness', JOB_READINESS_PHASE)}
          {renderPhase('Execution Phase', EXECUTION_PHASE)}
        </>
      )}

      {pipelineMode === 'custom' && activeCustomLayout && (
        <>
          {!customHasStages && (
            <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
              <Typography variant="body1" sx={{ mb: 1 }}>
                This pipeline has no columns yet.
              </Typography>
              {canModifyPipeline() && (
                <Button variant="outlined" size="small" onClick={openLayoutEditor}>
                  Edit pipeline — add stages
                </Button>
              )}
            </Box>
          )}
          {customHasStages &&
            [...activeCustomLayout.levels]
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
              .map((lvl) => renderPhase(lvl.title || 'Phase', lvl.stageKeys || []))}
        </>
      )}
      </Paper>

      <Dialog
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Customize Pipeline</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {shownStages.map((stageId) => {
              const override = getStageOverride(stageId);
              const hidden = !!override.hidden;
              const labelValue =
                override?.label && String(override.label).trim()
                  ? String(override.label).trim()
                  : STAGE_LABELS[stageId];
              const descriptionValue = override?.description ? String(override.description) : '';

              return (
                <Box
                  key={stageId}
                  sx={{
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                    p: 1.5,
                    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 2,
                      flexWrap: 'wrap',
                    }}
                  >
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={hidden}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setStageOverrides((prev) => ({
                              ...prev,
                              [stageId]: {
                                ...(prev?.[stageId] || {}),
                                hidden: checked,
                              },
                            }));
                          }}
                        />
                      }
                      label={`Hide ${stageId}`}
                    />
                    <TextField
                      size="small"
                      label="Stage label"
                      value={labelValue || stageId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStageOverrides((prev) => ({
                          ...prev,
                          [stageId]: {
                            ...(prev?.[stageId] || {}),
                            label: val,
                          },
                        }));
                      }}
                      sx={{ minWidth: 260 }}
                    />
                  </Box>
                  <TextField
                    size="small"
                    label="Description (hover tooltip on pipeline)"
                    value={descriptionValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStageOverrides((prev) => ({
                        ...prev,
                        [stageId]: {
                          ...(prev?.[stageId] || {}),
                          description: val,
                        },
                      }));
                    }}
                    multiline
                    minRows={2}
                    fullWidth
                    sx={{ mt: 1.5 }}
                    placeholder="What belongs in this stage? Shown when staff hover the info icon."
                  />
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomizeOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              const confirmed = window.confirm('Are you sure you want to save these stage changes?');
              if (!confirmed) return;
              try {
                const { data } = await axios.patch(`${API_URL}/tenants/pipeline-settings`, {
                  overrides: stageOverrides || {},
                });
                const saved =
                  data?.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides)
                    ? data.overrides
                    : {};
                setStageOverrides(saved);
                try {
                  localStorage.removeItem(pipelineStageConfigKey);
                  localStorage.removeItem(LEGACY_PIPELINE_STAGE_CONFIG_KEY);
                } catch (_) {}
                toast.success('Pipeline customization saved');
                setCustomizeOpen(false);
              } catch (err) {
                const msg = err.response?.data?.error || err.message || 'Failed to save';
                toast.error(msg);
              }
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(stageDescriptionEdit)}
        onClose={() => !savingStageDescription && setStageDescriptionEdit(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {stageDescriptionEdit ? `${getStageLabel(stageDescriptionEdit.stageId)} — description` : 'Stage description'}
        </DialogTitle>
        <DialogContent dividers>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={4}
            label="Description"
            value={stageDescriptionEdit?.description || ''}
            onChange={(e) =>
              setStageDescriptionEdit((prev) =>
                prev ? { ...prev, description: e.target.value } : prev,
              )
            }
            placeholder="Explain what belongs in this stage — shown when someone hovers the info icon."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStageDescriptionEdit(null)} disabled={savingStageDescription}>
            Cancel
          </Button>
          <Button variant="contained" onClick={saveStageDescription} disabled={savingStageDescription}>
            {savingStageDescription ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={layoutEditorOpen}
        onClose={() => !savingLayout && setLayoutEditorOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Edit pipeline layout</DialogTitle>
        <DialogContent dividers>
          {layoutDraft && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Pipeline title"
                value={layoutDraft.title}
                onChange={(e) => setLayoutDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                fullWidth
                size="small"
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Levels and stages
                </Typography>
                <Button
                  size="small"
                  onClick={() =>
                    setLayoutDraft((d) => {
                      if (!d) return d;
                      const next = [...(d.levels || [])];
                      next.push({
                        title: `Level ${next.length + 1}`,
                        order: next.length,
                        stageKeys: [],
                      });
                      return { ...d, levels: next };
                    })
                  }
                >
                  Add level
                </Button>
              </Box>
              {(layoutDraft.levels || []).map((lvl, idx) => (
                <Box
                  key={idx}
                  sx={{
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                    p: 1.5,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.5,
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField
                      size="small"
                      label="Level name"
                      value={lvl.title || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLayoutDraft((d) => {
                          if (!d) return d;
                          const levels = [...(d.levels || [])];
                          levels[idx] = { ...levels[idx], title: v };
                          return { ...d, levels };
                        });
                      }}
                      sx={{ flex: 1 }}
                    />
                    <Button
                      size="small"
                      color="error"
                      disabled={(layoutDraft.levels || []).length <= 1}
                      onClick={() =>
                        setLayoutDraft((d) => {
                          if (!d) return d;
                          const levels = (d.levels || []).filter((_, i) => i !== idx);
                          return { ...d, levels };
                        })
                      }
                    >
                      Remove
                    </Button>
                  </Box>
                  <Autocomplete
                    multiple
                    freeSolo
                    options={STAGE_NAME_SUGGESTIONS}
                    value={lvl.stageKeys || []}
                    onChange={(_, stageKeys) => {
                      setLayoutDraft((d) => {
                        if (!d) return d;
                        const levels = [...(d.levels || [])];
                        levels[idx] = {
                          ...levels[idx],
                          stageKeys: [...new Set((stageKeys || []).map((k) => String(k || '').trim()).filter(Boolean))],
                        };
                        return { ...d, levels };
                      });
                    }}
                    renderTags={(value, getTagProps) =>
                      value.map((option, tagIndex) => (
                        <Chip {...getTagProps({ index: tagIndex })} key={`${option}-${tagIndex}`} size="small" label={option} />
                      ))
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        label="Stages in this level"
                        placeholder="Type a stage and press Enter"
                      />
                    )}
                  />
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            color="error"
            onClick={deleteActiveLayout}
            disabled={savingLayout || !layoutDraft?._id}
          >
            Delete Pipeline
          </Button>
          <Button onClick={() => setLayoutEditorOpen(false)} disabled={savingLayout}>
            Cancel
          </Button>
          <Button variant="contained" onClick={saveLayoutDraft} disabled={savingLayout || !layoutDraft}>
            {savingLayout ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default PipelineBoard;