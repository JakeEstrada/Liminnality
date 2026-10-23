/**
 * JobArchivePage — Dead estimates and archived jobs by month.
 * Routes: /archive, /dead-estimates
 * APIs: GET /jobs/archive, GET /jobs/dead-estimates
 * Docs: ../../../docs/PAGES.md#jobarchivepagetsx
 */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Container,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Menu,
  ListItemIcon,
  ListItemText,
  useTheme,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Unarchive as UnarchiveIcon } from '@mui/icons-material';
import axios from 'axios';
import { formatMoney } from '../utils/paymentSchedule';
import toast from 'react-hot-toast';
import JobCard from '../components/pipeline/JobCard';
import JobDetailModal from '../components/jobs/JobDetailModal';
import { useAuth } from '../context/AuthContext';
import { useShopViewSensitive } from '../hooks/useShopViewSensitive';
import { useTenantRealtimeRefresh } from '../hooks/useSocketSubscription';
import { getTenantRoom } from '../services/socket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function JobArchivePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { user, tenantIdForBranding } = useAuth();
  const tenantRoom = getTenantRoom(tenantIdForBranding);
  const { hideSensitive } = useShopViewSensitive(user?.role);
  const [deadEstimates, setDeadEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [contextMenu, setContextMenu] = useState(null);
  const [contextMenuJob, setContextMenuJob] = useState(null);

  useEffect(() => {
    const initialize = async () => {
      // First, auto-move any dead estimates
      await autoMoveDeadEstimates();
      // Then fetch the updated archived jobs list
      await fetchArchivedJobs();
    };
    initialize();
  }, []);

  useTenantRealtimeRefresh(tenantRoom, () => fetchArchivedJobs({ background: true }));

  useEffect(() => {
    const yearFromUrl = Number.parseInt(searchParams.get('year') || '', 10);
    if (Number.isFinite(yearFromUrl)) {
      setSelectedYear(yearFromUrl);
    }
    setSearchQuery(searchParams.get('q') || '');
    if (!searchParams.get('jobId')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('jobId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const fetchArchivedJobs = async ({ background = false } = {}) => {
    try {
      if (!background) setLoading(true);
      const response = await axios.get(`${API_URL}/jobs/archive`);
      setDeadEstimates(response.data);
    } catch (error) {
      console.error('Error fetching archived jobs:', error);
      if (!background) toast.error('Failed to load archived jobs');
    } finally {
      if (!background) setLoading(false);
    }
  };

  const autoMoveDeadEstimates = async () => {
    try {
      const response = await axios.post(`${API_URL}/jobs/dead-estimates/auto-move`);
      if (response.data.count > 0) {
        console.log(`Auto-moved ${response.data.count} jobs to dead estimates`);
      }
    } catch (error) {
      console.error('Error auto-moving dead estimates:', error);
    }
  };

  const formatCurrency = formatMoney;

  const getTotalValue = (jobs) => {
    return jobs.reduce((sum, job) => sum + (job.valueEstimated || 0), 0);
  };

  const getDaysSinceSent = (sentAt) => {
    if (!sentAt) return null;
    const sentDate = new Date(sentAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - sentDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  const handleJobUpdate = async (jobId, updates) => {
    try {
      await axios.patch(`${API_URL}/jobs/${jobId}`, updates);
      toast.success('Job updated');
      fetchArchivedJobs(); // Refresh
    } catch (error) {
      console.error('Error updating job:', error);
      toast.error('Failed to update job');
    }
  };

  const handleJobDelete = async (jobId) => {
    await fetchArchivedJobs(); // Refresh the list
  };

  const handleJobArchive = async (jobId) => {
    await fetchArchivedJobs(); // Refresh the list
  };

  const handleJobDataChanged = () => {
    fetchArchivedJobs();
  };

  const handleContextMenu = (event, job) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(
      contextMenu === null
        ? {
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
          }
        : null
    );
    setContextMenuJob(job);
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
    setContextMenuJob(null);
  };

  const handleUnarchive = async () => {
    if (!contextMenuJob) return;
    
    try {
      const response = await axios.post(`${API_URL}/jobs/${contextMenuJob._id}/unarchive`);
      const restored = response.data;
      const stageLabel = restored?.stage ? restored.stage.replace(/_/g, ' ') : 'pipeline';
      toast.success(`Job restored to ${stageLabel}`);
      handleCloseContextMenu();
      await fetchArchivedJobs();
      navigate('/pipeline');
    } catch (error) {
      console.error('Error unarchiving job:', error);
      const message =
        error?.response?.data?.error || 'Failed to restore job from archive';
      toast.error(message);
    }
  };

  const matchesArchiveSearch = (job, rawQuery) => {
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) return true;
    const sentAt = job?.estimateMeta?.sentAt || job?.estimate?.sentAt || null;
    const estimateNumber = job?.estimateMeta?.estimateNumber || job?.estimate?.number || '';
    const estimateProjectName = job?.estimateMeta?.projectName || job?.estimate?.projectName || '';
    if (!job?.estimateMeta && job?.estimate) {
      console.warn('[estimate-deprecated] archive search fell back to job.estimate', { jobId: job?._id });
    }
    const haystack = [
      job?.title,
      job?.description,
      job?.stage,
      job?.customerId?.name,
      estimateNumber,
      estimateProjectName,
      sentAt ? new Date(sentAt).toLocaleDateString() : '',
    ]
      .map((x) => String(x || '').toLowerCase())
      .join(' ');
    return haystack.includes(q);
  };

  // Reorganize data by year, then by month
  const organizedByYear = useMemo(() => {
    const byYear = {};
    
    deadEstimates.forEach((group) => {
      const filteredJobs = (group.jobs || []).filter((job) => matchesArchiveSearch(job, searchQuery));
      if (filteredJobs.length === 0) {
        return;
      }
      const year = group.year;
      if (!byYear[year]) {
        byYear[year] = {
          year,
          months: []
        };
      }
      byYear[year].months.push({
        ...group,
        jobs: filteredJobs,
      });
    });
    
    // Sort months within each year (most recent first)
    Object.keys(byYear).forEach(year => {
      byYear[year].months.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });
    });
    
    return byYear;
  }, [deadEstimates, searchQuery]);

  // Get available years (sorted, most recent first)
  const availableYears = useMemo(() => {
    const years = Object.keys(organizedByYear).map(Number);
    return years.sort((a, b) => b - a);
  }, [organizedByYear]);

  useEffect(() => {
    if (availableYears.length === 0) return;
    if (availableYears.includes(selectedYear)) return;
    setSelectedYear(availableYears[0]);
  }, [availableYears, selectedYear]);

  // Get months for selected year
  const selectedYearMonths = useMemo(() => {
    return organizedByYear[selectedYear]?.months || [];
  }, [organizedByYear, selectedYear]);

  return (
    <Box>
      {/* Main Content */}
      <Container maxWidth="xl" sx={{ py: 4 }}>
        {/* Page Header */}
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h1" sx={{ mb: 1 }}>
                Job Archive
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Dead estimates - estimates sent but no response after 7 days
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
              {availableYears.length > 0 && (
                <FormControl sx={{ minWidth: 200 }}>
                <InputLabel id="year-select-label">Year</InputLabel>
                <Select
                  labelId="year-select-label"
                  id="year-select"
                  value={selectedYear}
                  label="Year"
                  onChange={(e) => setSelectedYear(e.target.value)}
                >
                  {availableYears.map((year) => (
                    <MenuItem key={year} value={year}>
                      {year}
                    </MenuItem>
                  ))}
                </Select>
                </FormControl>
              )}
            </Box>
          </Box>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : deadEstimates.length === 0 ? (
          <Card sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">
              No archived jobs yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Archived jobs and estimates with no response after 7 days will appear here
            </Typography>
          </Card>
        ) : selectedYearMonths.length === 0 ? (
          <Card sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">
              {searchQuery.trim()
                ? `No archived jobs found for "${searchQuery.trim()}"`
                : `No archived jobs for ${selectedYear}`}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {searchQuery.trim()
                ? 'Try a different name in the top search, or pick another year'
                : 'Select a different year to view archived jobs'}
            </Typography>
          </Card>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {selectedYearMonths.map((group, index) => (
              <Accordion
                key={`${group.year}-${group.month}`}
                defaultExpanded={index === 0 || Boolean(searchQuery.trim())}
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
                        {group.jobs.length} estimate{group.jobs.length !== 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 500 }}>
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
                    {group.jobs.map((job) => {
                      const sentAt = job?.estimateMeta?.sentAt || job?.estimate?.sentAt || null;
                      const daysSince = getDaysSinceSent(sentAt);
                      return (
                        <Card
                          key={job._id}
                          onClick={() => setSelectedJobId(job._id)}
                          onContextMenu={(e) => handleContextMenu(e, job)}
                          sx={{
                            borderLeft: '3px solid #D32F2F',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            '&:hover': {
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
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
                                {hideSensitive ? 'Locked' : formatCurrency(job.valueEstimated)}
                              </Typography>
                              {daysSince !== null && (
                                <Chip
                                  label={`${daysSince}d`}
                                  size="small"
                                  sx={{
                                    height: 18,
                                    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(211, 47, 47, 0.3)' : '#D32F2F15',
                                    color: 'error.main',
                                    fontSize: '0.65rem',
                                    fontWeight: 600,
                                    '& .MuiChip-label': { px: 0.75 },
                                  }}
                                />
                              )}
                            </Box>
                            {sentAt && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                Sent {new Date(sentAt).toLocaleDateString()}
                              </Typography>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
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

        {/* Context Menu */}
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
          <MenuItem onClick={handleUnarchive}>
            <ListItemIcon>
              <UnarchiveIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Restore from Archive</ListItemText>
          </MenuItem>
        </Menu>
      </Container>
    </Box>
  );
}

export default JobArchivePage;

