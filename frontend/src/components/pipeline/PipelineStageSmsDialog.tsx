import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import api from '../../utils/axios';
import {
  fillPipelineSmsTemplate,
  formatPromptPhone,
  resolveCustomerPhone,
  stageLabel,
  type PipelineSmsTemplate,
} from '../../utils/pipelineSmsTemplates';

type JobLike = {
  _id?: string;
  title?: string;
  jobContact?: { phone?: string };
  customerId?: {
    _id?: string;
    name?: string;
    primaryPhone?: string;
    phones?: string[];
    contactPhones?: Array<{ value?: string }>;
  };
};

export default function PipelineStageSmsDialog({
  open,
  job,
  stage,
  template,
  senderName,
  companyName,
  onClose,
}: {
  open: boolean;
  job: JobLike | null;
  stage: string;
  template: PipelineSmsTemplate | null;
  senderName: string;
  companyName: string;
  onClose: () => void;
}) {
  const customerName = String(job?.customerId && typeof job.customerId === 'object' ? job.customerId.name || '' : '');
  const phone = resolveCustomerPhone(job);
  const [body, setBody] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmOpen(false);
    setBody(fillPipelineSmsTemplate(template?.body || '', { customerName, senderName, companyName }));
  }, [open, template?.body, customerName, senderName, companyName]);

  const displayPhone = formatPromptPhone(phone);

  const handleDismiss = () => {
    if (sending) return;
    setConfirmOpen(false);
    onClose();
  };

  const handleSendClick = () => {
    if (!phone) {
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
      await api.post('/twilio/send-sms-adhoc', {
        to: phone,
        message: body.trim(),
        jobId: job?._id || undefined,
        customerId: job?.customerId?._id || undefined,
      });
      toast.success(`Text sent to ${customerName || displayPhone}`);
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
        <DialogTitle>Send {stageLabel(stage)} text?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {customerName || job?.title || 'This customer'} was moved to {stageLabel(stage)}. Review the
            message, then send it to {displayPhone || 'the number on file'} — or skip.
          </DialogContentText>
          {!phone ? (
            <Typography color="error" variant="body2" sx={{ mb: 2 }}>
              No phone number is connected to this customer.
            </Typography>
          ) : null}
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
          <Button onClick={handleDismiss} disabled={sending}>Skip</Button>
          <Button variant="contained" onClick={handleSendClick} disabled={!phone || !body.trim()}>
            Send text
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirmOpen} onClose={() => !sending && setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Are you sure?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Send this text to {customerName || 'the customer'} at {displayPhone}?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={sending}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void handleConfirmSend()} disabled={sending}>
            {sending ? 'Sending…' : 'Yes, send it'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
