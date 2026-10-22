import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import api from '../../utils/axios';
import {
  buildJobCardSmsContext,
  fetchCannedSmsTemplates,
  fillCannedSmsTemplate,
  type CannedSmsTemplate,
  type JobCardSmsSource,
} from '../../utils/cannedSmsTemplates';
import { formatPromptPhone, resolveCustomerPhone } from '../../utils/pipelineSmsTemplates';

export default function JobCannedSmsDialog({
  open,
  job,
  senderName,
  companyName,
  onClose,
  onSent,
}: {
  open: boolean;
  job: JobCardSmsSource | null;
  senderName: string;
  companyName: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const context = useMemo(
    () => buildJobCardSmsContext(job, { senderName, companyName }),
    [job, senderName, companyName],
  );
  const phone = resolveCustomerPhone(job);
  const displayPhone = formatPromptPhone(phone) || phone;
  const [templates, setTemplates] = useState<CannedSmsTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const enabledTemplates = useMemo(
    () => (templates || []).filter((row) => row.enabled !== false),
    [templates],
  );

  useEffect(() => {
    if (!open) return;
    setConfirmOpen(false);
    setTo(phone);
    let cancelled = false;
    setLoading(true);
    void fetchCannedSmsTemplates()
      .then((rows) => {
        if (cancelled) return;
        const enabled = rows.filter((row) => row.enabled !== false);
        setTemplates(rows);
        const first = enabled[0] || null;
        setSelectedId(first?.id || first?.name || '');
        setBody(first ? fillCannedSmsTemplate(first.body, context) : '');
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(
          isAxiosError(error) ? error.response?.data?.error || 'Failed to load canned messages' : 'Failed to load canned messages',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Snapshot job-card fields when the dialog opens so later customer edits do not wipe a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyTemplate = (row: CannedSmsTemplate) => {
    setSelectedId(row.id || row.name);
    setBody(fillCannedSmsTemplate(row.body, context));
  };

  const handleDismiss = () => {
    if (sending) return;
    setConfirmOpen(false);
    onClose();
  };

  const handleSendClick = () => {
    if (!to.trim()) {
      toast.error('This customer has no phone number on file');
      return;
    }
    if (!body.trim()) {
      toast.error('Message cannot be empty');
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmSend = async () => {
    setSending(true);
    try {
      const customerId =
        job?.customerId && typeof job.customerId === 'object' && job.customerId && '_id' in job.customerId
          ? String((job.customerId as { _id?: string })._id || '')
          : typeof job?.customerId === 'string'
            ? job.customerId
            : '';
      await api.post('/twilio/send-sms-adhoc', {
        to: to.trim(),
        message: body.trim(),
        jobId: job && '_id' in job && job._id ? String(job._id) : undefined,
        customerId: customerId || undefined,
      });
      toast.success(`Text sent to ${context.customerName || displayPhone || to}`);
      onSent?.();
      setConfirmOpen(false);
      onClose();
    } catch (error) {
      const msg = isAxiosError(error)
        ? error.response?.data?.error || error.message
        : 'Failed to send text';
      toast.error(String(msg));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={() => !confirmOpen && handleDismiss()} maxWidth="sm" fullWidth>
        <DialogTitle>Text the customer</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Pick a canned message. Name, email, phone, address, and job fill from this job card.
          </DialogContentText>
          <TextField
            label="Send to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
            placeholder="Customer phone"
            helperText={phone ? `On the job card: ${displayPhone}` : 'No phone is on this job card'}
          />
          {loading ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Loading canned messages…
            </Typography>
          ) : enabledTemplates.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              No canned messages yet. Add them on the Messages page under Canned messages.
            </Typography>
          ) : (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Canned messages
              </Typography>
              <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mt: 0.5 }}>
                {enabledTemplates.map((row, index) => {
                  const key = row.id || `${row.name}-${index}`;
                  const selected = selectedId === (row.id || row.name);
                  return (
                    <ListItemButton key={key} selected={selected} onClick={() => applyTemplate(row)}>
                      <ListItemText
                        primary={row.name}
                        secondary={row.body}
                        secondaryTypographyProps={{ noWrap: true }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          )}
          <TextField
            label="Message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            fullWidth
            multiline
            minRows={4}
            inputProps={{ maxLength: 1500 }}
            helperText={`${body.length} / 1500`}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleDismiss} disabled={sending}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSendClick} disabled={!to.trim() || !body.trim()}>
            Send text
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirmOpen} onClose={() => !sending && setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Are you sure?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Send this text to {context.customerName || 'the customer'} at {formatPromptPhone(to) || to}?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={sending}>
            Back
          </Button>
          <Button variant="contained" onClick={() => void handleConfirmSend()} disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
