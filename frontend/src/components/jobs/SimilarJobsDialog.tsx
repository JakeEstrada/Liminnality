import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type SimilarJobMatch = {
  jobId: string;
  title: string;
  customerName: string;
  stageLabel: string;
  snippet: string;
  score: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  jobId?: string;
  text?: string;
};

function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data;
    if (body && typeof body === 'object' && 'error' in body && body.error) {
      return String(body.error);
    }
  }
  return 'Could not search similar jobs';
}

/** Separate from the title search. Compares the worksheet note and opens the normal job. */
export default function SimilarJobsDialog({ open, onClose, jobId, text }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [matches, setMatches] = useState<SimilarJobMatch[]>([]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setNotice('');
      setMatches([]);
      try {
        const body: { jobId?: string; text?: string } = {};
        if (jobId) body.jobId = jobId;
        if (text) body.text = text;
        const response = await axios.post(`${API_URL}/jobs/similar`, body);
        if (cancelled) return;
        const next = Array.isArray(response.data?.matches) ? response.data.matches : [];
        setMatches(next);
        if (response.data?.compared === false) {
          setNotice(response.data.message || 'This job has no worksheet note to compare.');
        } else if (next.length === 0) {
          setNotice('No close matches yet. A job shows up here after its worksheet note is saved.');
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, jobId, text]);

  const openJob = (id: string) => {
    onClose();
    const staysOnPage =
      location.pathname === '/pipeline' ||
      location.pathname === '/pipeline-view' ||
      location.pathname === '/completed-jobs';
    if (staysOnPage) {
      const next = new URLSearchParams(searchParams);
      next.set('jobId', id);
      setSearchParams(next);
      return;
    }
    navigate(`/pipeline?jobId=${encodeURIComponent(id)}`);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Similar jobs</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Compares this worksheet note with other jobs.
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={28} aria-label="Finding similar jobs" />
          </Box>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!loading && notice ? <Typography variant="body2">{notice}</Typography> : null}
        <List disablePadding>
          {matches.map((match) => {
            const percent = Math.round((Number(match.score) || 0) * 100);
            const heading = [match.title || 'Untitled job', match.customerName].filter(Boolean).join(' · ');
            const detail = [
              `${percent}% similar`,
              match.stageLabel,
              match.snippet,
            ]
              .filter(Boolean)
              .join(' — ');
            return (
              <ListItemButton
                key={match.jobId}
                onClick={() => openJob(match.jobId)}
                sx={{ alignItems: 'flex-start', px: 1, borderRadius: 1 }}
              >
                <ListItemText
                  primary={heading}
                  secondary={detail}
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
              </ListItemButton>
            );
          })}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
