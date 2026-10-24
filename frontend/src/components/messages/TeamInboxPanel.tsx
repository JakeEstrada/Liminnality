/**
 * Team Outlook mail flagged in Paarth (worksheets to turn into jobs).
 * Shown on Messages → Team Inbox. APIs: /outlook/status, /outlook/messages, /outlook/sync
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { MailOutline as MailIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import api from '../../utils/axios';
import { useAuth } from '../../context/AuthContext';
import AddJobModal from '../jobs/AddJobModal';

type Sender = { email: string; name: string };

type OutlookStatus = {
  configured: boolean;
  connected: boolean;
  mailbox: string;
  mailboxName: string;
  lastSyncAt: string | null;
  lastSyncError: string;
  teamSenders: Sender[];
  subjectHints: string[];
  openCount: number;
  worksheetCount: number;
};

type InboxMessage = {
  id: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  preview: string;
  webLink: string;
  receivedAt: string;
  isWorksheet: boolean;
  outlookFlagged: boolean;
  status: 'new' | 'job_created' | 'dismissed';
  customerGuess: string;
};

const EMPTY_STATUS: OutlookStatus = {
  configured: false,
  connected: false,
  mailbox: '',
  mailboxName: '',
  lastSyncAt: null,
  lastSyncError: '',
  teamSenders: [],
  subjectHints: ['worksheet'],
  openCount: 0,
  worksheetCount: 0,
};

function errorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error) && error.response?.data?.error) return String(error.response.data.error);
  return fallback;
}

export default function TeamInboxPanel({ embedded = false }: { embedded?: boolean }) {
  const { isSuperAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<OutlookStatus>(EMPTY_STATUS);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [filter, setFilter] = useState<'worksheets' | 'team'>('worksheets');
  const [includeDone, setIncludeDone] = useState(false);
  const [senderDraft, setSenderDraft] = useState('');
  const [jobFor, setJobFor] = useState<InboxMessage | null>(null);

  const outlookQuery = params.get('outlook');
  const outlookMessage = params.get('message');

  const loadStatus = useCallback(async () => {
    const { data } = await api.get('/outlook/status');
    setStatus({ ...EMPTY_STATUS, ...data });
    return data as OutlookStatus;
  }, []);

  const loadMessages = useCallback(async (nextFilter = filter, done = includeDone) => {
    const { data } = await api.get('/outlook/messages', {
      params: {
        status: done ? 'all' : 'new',
        worksheets: nextFilter === 'worksheets' ? '1' : '0',
      },
    });
    setMessages(Array.isArray(data?.messages) ? data.messages : []);
  }, [filter, includeDone]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await loadStatus();
        await loadMessages();
      } catch (error) {
        if (!cancelled) toast.error(errorMessage(error, 'Failed to load Team Inbox'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMessages, loadStatus]);

  useEffect(() => {
    if (!outlookQuery) return;
    if (outlookQuery === 'connected') toast.success('Outlook connected');
    if (outlookQuery === 'error') toast.error(outlookMessage || 'Outlook connect failed');
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('outlook');
      next.delete('message');
      next.set('tab', 'inbox');
      return next;
    }, { replace: true });
  }, [outlookMessage, outlookQuery, setParams]);

  const connect = async () => {
    try {
      const { data } = await api.get('/outlook/auth-url');
      if (data?.authUrl) window.location.assign(data.authUrl);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not start Outlook connect'));
    }
  };

  const sync = async () => {
    try {
      setSyncing(true);
      const { data } = await api.post('/outlook/sync');
      setStatus({ ...EMPTY_STATUS, ...data });
      await loadMessages();
      const created = Number(data?.sync?.created) || 0;
      toast.success(created ? `Synced ${created} new message${created === 1 ? '' : 's'}` : 'Inbox is up to date');
    } catch (error) {
      toast.error(errorMessage(error, 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  };

  const saveSenders = async () => {
    const extra = senderDraft
      .split(/[\n,;]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((email) => ({ email, name: '' }));
    const teamSenders = [...status.teamSenders, ...extra];
    try {
      setSavingSettings(true);
      const { data } = await api.put('/outlook/settings', {
        teamSenders,
        subjectHints: status.subjectHints,
      });
      setStatus({ ...EMPTY_STATUS, ...data });
      setSenderDraft('');
      toast.success('Team senders saved');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save senders'));
    } finally {
      setSavingSettings(false);
    }
  };

  const removeSender = async (email: string) => {
    try {
      const { data } = await api.put('/outlook/settings', {
        teamSenders: status.teamSenders.filter((row) => row.email !== email),
        subjectHints: status.subjectHints,
      });
      setStatus({ ...EMPTY_STATUS, ...data });
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update senders'));
    }
  };

  const setMessageStatus = async (row: InboxMessage, next: InboxMessage['status'], jobId?: string) => {
    try {
      const { data } = await api.patch(`/outlook/messages/${row.id}`, { status: next, jobId });
      const updated = data?.message as InboxMessage | undefined;
      setMessages((prev) =>
        prev
          .map((item) => (item.id === row.id ? { ...item, ...updated } : item))
          .filter((item) => includeDone || item.status === 'new'),
      );
      const nextStatus = await loadStatus();
      setStatus(nextStatus);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update message'));
    }
  };

  const visible = messages.filter((row) => {
    if (!includeDone && row.status !== 'new') return false;
    if (filter === 'worksheets' && !row.isWorksheet) return false;
    return true;
  });

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          {embedded ? (
            <Typography variant="body2" color="text.secondary">
              Outlook mail from your team. Worksheets stay flagged here until you create the pipeline job.
            </Typography>
          ) : (
            <>
              <Typography variant="h1" sx={{ mb: 1 }}>
                Team Inbox
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Pulls Outlook mail from your team. Worksheets stay flagged here until you create the pipeline job.
              </Typography>
            </>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {isSuperAdmin() && !status.connected ? (
            <Button variant="contained" onClick={() => void connect()} sx={{ textTransform: 'none' }}>
              Connect Outlook
            </Button>
          ) : null}
          {isSuperAdmin() && status.connected ? (
            <Button variant="outlined" onClick={() => void sync()} disabled={syncing} startIcon={<RefreshIcon />} sx={{ textTransform: 'none' }}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          ) : null}
        </Box>
      </Box>

      {!status.configured ? (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Microsoft Graph is not configured on the API yet. Add <code>MICROSOFT_CLIENT_ID</code>,{' '}
          <code>MICROSOFT_CLIENT_SECRET</code>, and <code>MICROSOFT_REDIRECT_URI</code> (your API{' '}
          <code>/outlook/auth/callback</code>) then restart. Azure app needs delegated Mail.Read, Mail.ReadWrite, User.Read, and offline_access.
        </Alert>
      ) : null}

      {status.connected ? (
        <Alert severity="success" sx={{ mb: 3 }} icon={<MailIcon />}>
          Reading {status.mailboxName ? `${status.mailboxName} · ` : ''}
          {status.mailbox || 'connected mailbox'}
          {status.lastSyncAt ? ` · last sync ${format(new Date(status.lastSyncAt), 'MMM d, h:mm a')}` : ''}
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>
          Connect the mailbox that receives Joe’s worksheets. Then add team addresses (Joe’s email) so Liminnality only flags their mail.
        </Alert>
      )}

      {status.lastSyncError ? (
        <Alert severity="error" sx={{ mb: 3 }}>
          {status.lastSyncError}
        </Alert>
      ) : null}

      {isSuperAdmin() ? (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
            Team senders
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Only mail from these addresses is pulled. Subject containing “worksheet” is flagged in Outlook and listed as a job to create.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            {status.teamSenders.length ? (
              status.teamSenders.map((row) => (
                <Chip key={row.email} label={row.name ? `${row.name} · ${row.email}` : row.email} onDelete={() => void removeSender(row.email)} />
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                None yet — add Joe’s Outlook address.
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField
              size="small"
              label="Add email"
              placeholder="joe@…"
              value={senderDraft}
              onChange={(e) => setSenderDraft(e.target.value)}
              sx={{ minWidth: 260, flex: 1 }}
            />
            <Button variant="outlined" onClick={() => void saveSenders()} disabled={savingSettings || !senderDraft.trim()} sx={{ textTransform: 'none' }}>
              Add
            </Button>
          </Box>
        </Paper>
      ) : null}

      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_, next) => {
            if (next) setFilter(next);
          }}
        >
          <ToggleButton value="worksheets" sx={{ textTransform: 'none' }}>
            Worksheets ({status.worksheetCount})
          </ToggleButton>
          <ToggleButton value="team" sx={{ textTransform: 'none' }}>
            All team ({status.openCount})
          </ToggleButton>
        </ToggleButtonGroup>
        <Button size="small" onClick={() => setIncludeDone((prev) => !prev)} sx={{ textTransform: 'none' }}>
          {includeDone ? 'Hide done' : 'Show done'}
        </Button>
      </Box>

      <Paper>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, minWidth: 160 }}>Received</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>From</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Subject</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                    <Typography color="text.secondary">
                      {status.connected
                        ? 'No matching team mail. Add senders, then Sync now.'
                        : 'Connect Outlook to pull worksheets here.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {row.receivedAt ? format(new Date(row.receivedAt), 'MMM d, h:mm a') : '—'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.fromName || row.fromEmail}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.fromEmail}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="body2">{row.subject || '(no subject)'}</Typography>
                        {row.isWorksheet ? <Chip size="small" color="warning" label="Worksheet" /> : null}
                        {row.outlookFlagged ? <Chip size="small" label="Flagged in Outlook" /> : null}
                        {row.status !== 'new' ? <Chip size="small" label={row.status === 'job_created' ? 'Job created' : 'Dismissed'} /> : null}
                      </Box>
                      {row.preview ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {row.preview}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {row.webLink ? (
                          <Button size="small" href={row.webLink} target="_blank" rel="noreferrer" sx={{ textTransform: 'none' }}>
                            Open
                          </Button>
                        ) : null}
                        {row.status === 'new' ? (
                          <>
                            <Button size="small" variant="contained" onClick={() => setJobFor(row)} sx={{ textTransform: 'none' }}>
                              Create job
                            </Button>
                            <Button size="small" onClick={() => void setMessageStatus(row, 'dismissed')} sx={{ textTransform: 'none' }}>
                              Dismiss
                            </Button>
                          </>
                        ) : null}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <AddJobModal
        open={Boolean(jobFor)}
        onClose={() => setJobFor(null)}
        initialCustomerName={jobFor?.customerGuess || ''}
        initialTitle={jobFor?.customerGuess || jobFor?.subject || ''}
        initialDescription={jobFor ? `From Outlook: ${jobFor.subject}` : ''}
        onJobCreated={(job) => {
          if (jobFor) void setMessageStatus(jobFor, 'job_created', job?._id || job?.id);
          setJobFor(null);
        }}
      />
    </Box>
  );
}
