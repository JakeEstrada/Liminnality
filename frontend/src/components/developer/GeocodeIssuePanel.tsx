import { Box, Button, Paper, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import api from '../../utils/axios';

type GeoIssue = {
  id: string;
  title: string;
  stage: string;
  customerName: string;
  address: string;
  reason: string;
  isArchived?: boolean;
  isDeadEstimate?: boolean;
};

type CoordDraft = { lat: string; lng: string };

export default function GeocodeIssuePanel() {
  const [jobs, setJobs] = useState<GeoIssue[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<Record<string, CoordDraft>>({});
  const [savingId, setSavingId] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api
      .get('/jobs/geo-issues')
      .then((response) => {
        if (!cancelled) setJobs(response.data?.jobs || []);
      })
      .catch(() => {
        if (!cancelled) setJobs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return jobs;
    return jobs.filter((job) =>
      [job.customerName, job.title, job.address, job.reason, job.stage]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [jobs, query]);

  const setCoord = (jobId: string, field: 'lat' | 'lng', value: string) => {
    setCoords((current) => ({
      ...current,
      [jobId]: { lat: '', lng: '', ...current[jobId], [field]: value },
    }));
  };

  const saveCoords = async (job: GeoIssue) => {
    const draft = coords[job.id] || { lat: '', lng: '' };
    const lat = Number(draft.lat);
    const lng = Number(draft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setSaveError('Enter both latitude and longitude.');
      return;
    }
    setSaveError('');
    setSavingId(job.id);
    try {
      await api.patch(`/jobs/${job.id}`, { geo: { lat, lng } });
      setJobs((list) => list.filter((row) => row.id !== job.id));
    } catch {
      setSaveError('Could not save those coordinates.');
    } finally {
      setSavingId('');
    }
  };

  return (
    <Paper sx={{ p: 2.5, mb: 4, borderRadius: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        Jobs missing map points ({jobs.length})
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        These addresses did not convert to a map point. Fix the street and ZIP on the job, or paste
        latitude and longitude here. New jobs geocode automatically when they have a street address.
      </Typography>
      <TextField
        size="small"
        fullWidth
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search customer, job, address..."
        sx={{ mb: 2 }}
      />
      {saveError ? (
        <Typography variant="body2" color="error" sx={{ mb: 1.5 }}>
          {saveError}
        </Typography>
      ) : null}
      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : null}
      {!loading && !filtered.length ? (
        <Typography variant="body2" color="text.secondary">
          {jobs.length ? 'No matches.' : 'Every job with an address has a map point.'}
        </Typography>
      ) : null}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 520, overflow: 'auto' }}>
        {filtered.map((job) => {
          const draft = coords[job.id] || { lat: '', lng: '' };
          return (
            <Box
              key={job.id}
              sx={{
                p: 1.5,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {job.customerName || 'No customer'} · {job.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {job.address || 'No address'} · {job.reason}
                {job.isArchived ? ' · archived' : ''}
                {job.isDeadEstimate ? ' · dead estimate' : ''}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="Latitude"
                  value={draft.lat}
                  onChange={(event) => setCoord(job.id, 'lat', event.target.value)}
                  sx={{ width: 150 }}
                />
                <TextField
                  size="small"
                  label="Longitude"
                  value={draft.lng}
                  onChange={(event) => setCoord(job.id, 'lng', event.target.value)}
                  sx={{ width: 150 }}
                />
                <Button
                  size="small"
                  variant="contained"
                  disabled={savingId === job.id}
                  onClick={() => void saveCoords(job)}
                  sx={{ textTransform: 'none' }}
                >
                  {savingId === job.id ? 'Saving…' : 'Save pin'}
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
