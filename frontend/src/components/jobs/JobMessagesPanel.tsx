import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { Image as ImageIcon, Send as SendIcon, Sms as SmsIcon } from '@mui/icons-material';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import { useTheme } from '@mui/material/styles';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import api from '../../utils/axios';
import { fetchSmsLists, markJobSmsRead, type SmsRow } from '../../utils/twilioApi';
import SmsMessagePhotos from '../messages/SmsMessagePhotos';
import { formatPromptPhone, resolveCustomerPhone } from '../../utils/pipelineSmsTemplates';
import { useAuth } from '../../context/AuthContext';
import { useSocketSubscription } from '../../hooks/useSocketSubscription';
import { getTenantRoom } from '../../services/socket';

type JobLike = {
  _id?: string;
  unreadCustomerSmsCount?: number;
  jobContact?: { phone?: string };
  customerId?:
    | {
        _id?: string;
        name?: string;
        primaryPhone?: string;
        phones?: string[];
        contactPhones?: Array<{ value?: string }>;
      }
    | string
    | null;
};

type ThreadMessage = SmsRow & { direction: 'inbound' | 'outbound' };

function messageTime(row: SmsRow) {
  return new Date(row.sentAt || row.sendAt || row.createdAt).getTime() || 0;
}

function formatThreadDay(value: string | null | undefined) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEE, MMM d');
}

function formatThreadTime(value: string | null | undefined) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'h:mm a');
}

function deliveryLabel(row: ThreadMessage) {
  const status = String(row.deliveryStatus || row.status || '').toLowerCase();
  if (row.direction === 'inbound') return row.status === 'unread' ? 'Unread' : '';
  if (status === 'failed' || status === 'undelivered') return 'Not delivered';
  if (status === 'delivered' || row.deliveredAt) return 'Delivered';
  if (status === 'sent' || status === 'read') return 'Sent';
  if (status === 'queued' || status === 'sending') return 'Sending';
  return '';
}

export default function JobMessagesPanel({
  job,
  refreshKey = 0,
  onOpenCanned,
}: {
  job: JobLike | null;
  refreshKey?: number;
  onOpenCanned: () => void;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { tenantIdForBranding } = useAuth();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const jobId = job?._id ? String(job._id) : '';
  const customer =
    job?.customerId && typeof job.customerId === 'object' ? job.customerId : null;
  const customerName = String(customer?.name || '').trim();
  const phone = resolveCustomerPhone(job);
  const displayPhone = formatPromptPhone(phone) || phone;

  const loadMessages = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const lists = await fetchSmsLists(500, { jobId });
      const next: ThreadMessage[] = [
        ...(lists.sent || []).map((row) => ({ ...row, direction: 'outbound' as const })),
        ...(lists.received || []).map((row) => ({ ...row, direction: 'inbound' as const })),
      ].sort((a, b) => messageTime(a) - messageTime(b));
      setMessages(next);
      const hasUnread =
        next.some((row) => row.direction === 'inbound' && row.status === 'unread') ||
        Number(job?.unreadCustomerSmsCount || 0) > 0;
      if (hasUnread) {
        await markJobSmsRead(jobId);
        setMessages((prev) =>
          prev.map((row) =>
            row.direction === 'inbound' && row.status === 'unread' ? { ...row, status: 'read' } : row,
          ),
        );
      }
    } catch (error) {
      toast.error(
        isAxiosError(error) ? error.response?.data?.error || 'Failed to load messages' : 'Failed to load messages',
      );
    } finally {
      setLoading(false);
    }
  }, [jobId, job?.unreadCustomerSmsCount]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages, refreshKey]);

  useSocketSubscription(
    tenantIdForBranding ? getTenantRoom(tenantIdForBranding) : null,
    'sms.inbound.created',
    loadMessages,
  );

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  const unreadCount = useMemo(
    () => messages.filter((row) => row.direction === 'inbound' && row.status === 'unread').length,
    [messages],
  );

  const clearPhoto = () => {
    setPhoto(null);
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
  };

  const choosePhoto = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose a photo');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo must be 5 MB or smaller');
      return;
    }
    clearPhoto();
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSend = async () => {
    if (!phone.trim() || sending || (!body.trim() && !photo)) return;
    setSending(true);
    try {
      let mediaFileId = '';
      if (photo) {
        const form = new FormData();
        form.append('file', photo);
        const uploaded = await api.post('/twilio/mms-upload', form);
        mediaFileId = String(uploaded.data?.fileId || '');
      }
      await api.post('/twilio/send-sms-adhoc', {
        to: phone.trim(),
        message: body.trim(),
        jobId: jobId || undefined,
        customerId: customer?._id || undefined,
        ...(mediaFileId ? { mediaFileId } : {}),
      });
      setBody('');
      clearPhoto();
      toast.success(`Text sent to ${customerName || displayPhone || phone}`);
      await loadMessages();
    } catch (error) {
      toast.error(
        isAxiosError(error) ? error.response?.data?.error || 'Failed to send text' : 'Failed to send text',
      );
    } finally {
      setSending(false);
    }
  };

  const outboundBg = theme.palette.primary.main;
  const outboundColor = theme.palette.primary.contrastText;
  const inboundBg = isDark ? 'rgba(255,255,255,0.12)' : '#E9E9EB';
  const inboundColor = theme.palette.text.primary;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {customerName || 'Customer'} {displayPhone ? `· ${displayPhone}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Texts sent from this job and replies from the customer.
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<SmsIcon />} onClick={onOpenCanned}>
          Canned text
        </Button>
      </Box>

      <Paper
        variant="outlined"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: { xs: 420, sm: 480 },
          overflow: 'hidden',
        }}
      >
        <Box
          ref={threadRef}
          sx={{
            flex: 1,
            overflow: 'auto',
            px: 2,
            py: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            bgcolor: isDark ? 'background.default' : '#F2F2F7',
          }}
        >
          {loading && !messages.length ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} />
            </Box>
          ) : messages.length ? (
            messages.map((row, index) => {
              const when = row.sentAt || row.sendAt || row.createdAt;
              const prev = messages[index - 1];
              const prevWhen = prev ? prev.sentAt || prev.sendAt || prev.createdAt : null;
              const showDay = !prevWhen || !when || !isSameDay(new Date(when), new Date(prevWhen));
              const outbound = row.direction === 'outbound';
              const failed = /fail|undelivered/i.test(String(row.deliveryStatus || row.status || ''));
              return (
                <Box key={`${row.recordType}-${row.id}`}>
                  {showDay ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', textAlign: 'center', my: 1.5, fontWeight: 600 }}
                    >
                      {formatThreadDay(when)}
                    </Typography>
                  ) : null}
                  <Box sx={{ display: 'flex', justifyContent: outbound ? 'flex-end' : 'flex-start' }}>
                    <Box
                      sx={{
                        maxWidth: '78%',
                        px: 1.5,
                        py: 1,
                        borderRadius: outbound ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        bgcolor: failed ? 'error.main' : outbound ? outboundBg : inboundBg,
                        color: failed ? 'error.contrastText' : outbound ? outboundColor : inboundColor,
                      }}
                    >
                      <SmsMessagePhotos messageId={row.id} media={row.media} />
                      {row.body ? (
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {row.body}
                        </Typography>
                      ) : null}
                    </Box>
                  </Box>
                  <Typography
                    variant="caption"
                    color={failed ? 'error' : 'text.secondary'}
                    sx={{
                      display: 'block',
                      textAlign: outbound ? 'right' : 'left',
                      px: 0.5,
                      mt: 0.25,
                    }}
                  >
                    {[formatThreadTime(when), deliveryLabel(row)].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              );
            })
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 8 }}>
              No texts on this job yet. Send one below or use a canned message.
            </Typography>
          )}
        </Box>

        <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          {!phone ? (
            <Typography variant="body2" color="text.secondary">
              Add a customer phone on the job card to text from here.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                onChange={(event) => {
                  choosePhoto(event.target.files?.[0] || null);
                  event.target.value = '';
                }}
              />
              {photoPreview ? (
                <Box
                  component="img"
                  src={photoPreview}
                  alt="Photo to send"
                  onClick={clearPhoto}
                  sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1, cursor: 'pointer' }}
                />
              ) : null}
              <IconButton onClick={() => photoInputRef.current?.click()} aria-label="Attach photo" disabled={sending}>
                <ImageIcon />
              </IconButton>
              <TextField
                placeholder={`Message ${customerName || displayPhone || 'customer'}`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                fullWidth
                multiline
                minRows={2}
                maxRows={6}
                disabled={sending}
                inputProps={{ maxLength: 1500 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <IconButton
                color="primary"
                onClick={() => void handleSend()}
                disabled={(!body.trim() && !photo) || sending}
                aria-label="Send message"
              >
                {sending ? <CircularProgress size={20} /> : <SendIcon />}
              </IconButton>
            </Box>
          )}
        </Box>
      </Paper>
      {unreadCount ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {unreadCount} unread {unreadCount === 1 ? 'reply' : 'replies'} marked read when you open this tab.
        </Typography>
      ) : null}
    </Box>
  );
}
