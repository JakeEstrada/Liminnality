/**
 * MessagePage — phone-style SMS conversations, scheduled texts, team inbox, flag and canned templates.
 * Route: /messages  Query: ?tab=inbox|flags|canned|scheduled
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Paper,
} from '@mui/material';
import { DeleteOutline as DeleteOutlineIcon, Refresh as RefreshIcon, Sms as SmsIcon } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import { format } from 'date-fns';
import api from '../utils/axios';
import CannedMessagesPanel from '../components/messages/CannedMessagesPanel';
import FlagMessagesPanel from '../components/messages/FlagMessagesPanel';
import SmsConversationView, { type ChatMessage } from '../components/messages/SmsConversationView';
import TeamInboxPanel from '../components/messages/TeamInboxPanel';
import { formatPhoneForDisplay } from '../utils/phoneFormat';
import {
  deleteSms,
  deleteSmsConversation,
  fetchSmsDetail,
  fetchSmsLists,
  markSmsRead,
  scheduleSmsAdhoc,
  syncInboundFromTwilio,
  type SmsDetail,
  type SmsLists,
  type SmsRecordType,
  type SmsRow,
} from '../utils/twilioApi';
import { useAuth } from '../context/AuthContext';
import { useSocketSubscription } from '../hooks/useSocketSubscription';
import { getTenantRoom } from '../services/socket';

const LIST_PAGE_SIZE = 500;
const LIST_MAX = 2000;
const EMPTY_LISTS: SmsLists = { scheduled: [], sent: [], received: [] };

type MessageTab = 'messages' | 'scheduled' | 'inbox' | 'flags' | 'canned';

function parseMessageTab(raw: string | null, admin: boolean): MessageTab {
  if (raw === 'inbox') return admin ? 'inbox' : 'messages';
  if (raw === 'flags' || raw === 'canned' || raw === 'scheduled') return raw;
  return 'messages';
}

function formatWhen(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, 'MMM d, yyyy h:mm a');
}

function formatPhone(value: string | null | undefined) {
  if (!value) return '—';
  return formatPhoneForDisplay(value) || value;
}

function rowRecordType(row: SmsRow, tab: 'sent' | 'scheduled' | 'received'): SmsRecordType {
  if (row.recordType) return row.recordType;
  return tab === 'scheduled' ? 'scheduled' : 'message';
}

function statusChip(status: string) {
  const normalized = String(status || '').toLowerCase();
  let color: 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info' = 'default';
  if (normalized === 'scheduled') color = 'primary';
  else if (normalized === 'delivered' || normalized === 'sent' || normalized === 'read') color = 'success';
  else if (normalized === 'received') color = 'success';
  else if (normalized === 'failed' || normalized === 'undelivered') color = 'error';
  else if (normalized === 'cancelled') color = 'warning';
  else if (normalized === 'unread') color = 'info';
  else if (normalized === 'queued' || normalized === 'sending') color = 'default';
  const label =
    normalized === 'undelivered'
      ? 'Undelivered'
      : normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return <Chip label={label} size="small" color={color} sx={{ textTransform: 'capitalize' }} />;
}

function ReceiptTimeline({ detail }: { detail: SmsDetail }) {
  const items: { label: string; at: string | null | undefined }[] = [];

  if (detail.kind === 'scheduled' && detail.status === 'scheduled') {
    items.push({ label: 'Scheduled to send', at: detail.sendAt });
  } else {
    if (detail.sentAt) items.push({ label: 'Sent', at: detail.sentAt });
    if (detail.deliveredAt) items.push({ label: 'Delivered to handset', at: detail.deliveredAt });
    if (detail.readAt) items.push({ label: 'Read in app', at: detail.readAt });
    if (detail.statusUpdatedAt && !detail.deliveredAt && !detail.readAt) {
      items.push({ label: 'Status updated', at: detail.statusUpdatedAt });
    }
  }

  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No delivery timestamps yet.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((item) => (
        <Box key={item.label}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {item.label}
          </Typography>
          <Typography variant="body2">{formatWhen(item.at)}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function MessageDetailDialog({
  open,
  detail,
  loading,
  deleting,
  onClose,
  onDelete,
}: {
  open: boolean;
  detail: SmsDetail | null;
  loading: boolean;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const isReceived = detail?.direction === 'inbound';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isReceived ? 'Received message' : 'Message details'}</DialogTitle>
      <DialogContent dividers>
        {loading || !detail ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              {statusChip(detail.status)}
              {detail.deliveryStatus && detail.deliveryStatus !== detail.status && (
                <Chip
                  label={`Carrier: ${detail.deliveryStatus}`}
                  size="small"
                  variant="outlined"
                />
              )}
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">
                {isReceived ? 'From' : 'To'}
              </Typography>
              <Typography variant="body1">
                {isReceived ? formatPhone(detail.from) : formatPhone(detail.to)}
              </Typography>
            </Box>

            {!isReceived && detail.from && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  From (your number)
                </Typography>
                <Typography variant="body1">{formatPhone(detail.from)}</Typography>
              </Box>
            )}

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Message
              </Typography>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {detail.fullBody || detail.body || '—'}
                </Typography>
              </Paper>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Delivery & read status
              </Typography>
              <ReceiptTimeline detail={detail} />
              {(detail.errorMessage || detail.lastError) && (
                <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                  {detail.errorMessage || detail.lastError}
                </Typography>
              )}
            </Box>

            <Typography variant="caption" color="text.secondary">
              {detail.receiptsNote}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="error" onClick={onDelete} disabled={loading || deleting || !detail} sx={{ mr: 'auto' }}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
        <Button onClick={onClose} disabled={deleting}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MessageTable({
  rows,
  tab,
  loading,
  onOpenRow,
  onDeleteRow,
}: {
  rows: SmsRow[];
  tab: 'sent' | 'scheduled' | 'received';
  loading: boolean;
  onOpenRow: (row: SmsRow) => void;
  onDeleteRow?: (row: SmsRow) => void;
}) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (rows.length === 0) {
    const emptyCopy =
      tab === 'scheduled'
        ? 'No scheduled messages.'
        : tab === 'received'
          ? 'No received messages yet. If Twilio already has replies, click “Pull replies from Twilio” above. New replies only appear here after Twilio’s incoming webhook points at your API (/twilio/sms).'
          : 'No sent messages yet.';
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center', px: 2 }}>
        {emptyCopy}
      </Typography>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            {tab === 'received' ? (
              <TableCell>From</TableCell>
            ) : (
              <TableCell>To</TableCell>
            )}
            <TableCell>Message</TableCell>
            <TableCell>{tab === 'scheduled' ? 'Send at' : 'When'}</TableCell>
            <TableCell>Status</TableCell>
            {onDeleteRow ? <TableCell padding="checkbox" /> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={`${rowRecordType(row, tab)}-${row.id}`}
              hover
              onClick={() => onOpenRow(row)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {tab === 'received' ? formatPhone(row.from) : formatPhone(row.to)}
              </TableCell>
              <TableCell sx={{ maxWidth: 360 }}>
                <Typography variant="body2" noWrap>
                  {row.body || '—'}
                </Typography>
                {row.lastError && (
                  <Typography variant="caption" color="error">
                    {row.lastError}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {tab === 'scheduled' ? formatWhen(row.sendAt) : formatWhen(row.sentAt || row.createdAt)}
              </TableCell>
              <TableCell>{statusChip(row.status)}</TableCell>
              {onDeleteRow ? (
                <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                  <IconButton
                    size="small"
                    aria-label="Delete message"
                    onClick={() => onDeleteRow(row)}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function MessagePage() {
  const { isAdmin, tenantIdForBranding } = useAuth();
  const admin = isAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const [syncingInbound, setSyncingInbound] = useState(false);
  const tab = parseMessageTab(searchParams.get('tab'), admin);
  const setTab = (next: MessageTab) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'messages') params.delete('tab');
      else params.set('tab', next);
      return params;
    }, { replace: true });
  };
  const [sending, setSending] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [lists, setLists] = useState<SmsLists>(EMPTY_LISTS);
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const [loadingLists, setLoadingLists] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<SmsDetail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'message'; recordType: SmsRecordType; id: string; label: string }
    | { kind: 'conversation'; phone: string; label: string }
    | null
  >(null);

  const fetchMessages = useCallback(async (limit = listLimit, { silent = false } = {}) => {
    if (!silent) setLoadingLists(true);
    try {
      setLists(await fetchSmsLists(limit));
    } catch (error) {
      console.error(error);
      let msg = isAxiosError(error)
        ? error.response?.data?.error || error.message || 'Failed to load messages'
        : error instanceof Error
          ? error.message
          : 'Failed to load messages';
      if (isAxiosError(error) && error.response?.status === 404) {
        msg =
          'Messages API is not available on the server yet. Deploy or restart the backend with the latest code.';
      }
      toast.error(msg);
    } finally {
      if (!silent) setLoadingLists(false);
    }
  }, [listLimit]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  const handleInboundSms = useCallback(() => {
    void fetchMessages(listLimit, { silent: true });
  }, [fetchMessages, listLimit]);

  useSocketSubscription(
    tenantIdForBranding ? getTenantRoom(tenantIdForBranding) : null,
    'sms.inbound.created',
    handleInboundSms,
  );

  const handleOpenMessage = async (row: SmsRow, tabKey: 'sent' | 'scheduled' | 'received') => {
    const recordType = rowRecordType(row, tabKey);
    setDetailOpen(true);
    setDetailLoading(true);
    setSelectedDetail(null);
    try {
      const detail = await fetchSmsDetail(recordType, row.id);
      if (tabKey === 'received' && detail.canMarkRead) {
        const updated = await markSmsRead(row.id);
        setSelectedDetail(updated);
        void fetchMessages(listLimit, { silent: true });
      } else {
        setSelectedDetail(detail);
      }
    } catch (error) {
      console.error(error);
      const msg = isAxiosError(error)
        ? error.response?.data?.error || error.message || 'Failed to load message'
        : error instanceof Error
          ? error.message
          : 'Failed to load message';
      toast.error(msg);
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleOpenChatMessage = (row: ChatMessage) => {
    const tabKey =
      row.kind === 'received' || row.direction === 'inbound'
        ? 'received'
        : row.recordType === 'scheduled'
          ? 'scheduled'
          : 'sent';
    void handleOpenMessage(row, tabKey);
  };

  const handleOpenConversation = useCallback(async (unreadIds: string[]) => {
    if (!unreadIds.length) return;
    try {
      await Promise.all(unreadIds.map((id) => markSmsRead(id)));
      await fetchMessages(listLimit, { silent: true });
    } catch {
      /* unread badge updates on next refresh */
    }
  }, [fetchMessages, listLimit]);

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setSelectedDetail(null);
  };

  const handleDeleteMessage = (row: SmsRow, tabKey: 'sent' | 'scheduled' | 'received') => {
    setPendingDelete({
      kind: 'message',
      recordType: rowRecordType(row, tabKey),
      id: row.id,
      label: (row.body || 'this message').slice(0, 80),
    });
  };

  const handleDeleteConversation = (phone: string, label: string) => {
    setPendingDelete({ kind: 'conversation', phone, label });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === 'conversation') {
        const result = await deleteSmsConversation(pendingDelete.phone);
        if (!result.deleted) toast.error('Could not find that conversation');
        else toast.success(result.deleted === 1 ? 'Conversation deleted' : `Removed ${result.deleted} messages`);
      } else {
        await deleteSms(pendingDelete.recordType, pendingDelete.id);
        toast.success('Message deleted');
      }
      setPendingDelete(null);
      await fetchMessages(listLimit, { silent: true });
    } catch (error) {
      console.error(error);
      const msg = isAxiosError(error)
        ? error.response?.data?.error || error.message || 'Failed to delete'
        : error instanceof Error
          ? error.message
          : 'Failed to delete';
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleSend = async (to: string, message: string) => {
    if (!to.trim()) {
      toast.error('Enter a phone number');
      return;
    }
    if (!message.trim()) {
      toast.error('Enter a message');
      return;
    }
    setSending(true);
    try {
      await api.post('/twilio/send-sms-adhoc', { to: to.trim(), message: message.trim() });
      toast.success('Message sent');
      setTab('messages');
      await fetchMessages(listLimit, { silent: true });
    } catch (error) {
      console.error(error);
      const msg = isAxiosError(error)
        ? error.response?.data?.error || error.message || 'Failed to send'
        : error instanceof Error
          ? error.message
          : 'Failed to send';
      toast.error(msg);
      throw error;
    } finally {
      setSending(false);
    }
  };

  const handleSchedule = async (to: string, message: string, sendAtLocal: string) => {
    if (!to.trim()) {
      toast.error('Enter a phone number');
      return;
    }
    if (!message.trim()) {
      toast.error('Enter a message');
      return;
    }
    if (!sendAtLocal) {
      toast.error('Choose a send date and time');
      return;
    }
    const sendAt = new Date(sendAtLocal);
    if (Number.isNaN(sendAt.getTime())) {
      toast.error('Invalid send date and time');
      return;
    }
    if (sendAt.getTime() <= Date.now()) {
      toast.error('Send time must be in the future');
      return;
    }

    setScheduling(true);
    try {
      await scheduleSmsAdhoc({ to: to.trim(), message: message.trim(), sendAt: sendAt.toISOString() });
      toast.success(`SMS scheduled for ${format(sendAt, 'MMM d, yyyy h:mm a')}`);
      await fetchMessages(listLimit, { silent: true });
    } catch (error) {
      console.error(error);
      const msg = isAxiosError(error)
        ? error.response?.data?.error || error.message || 'Failed to schedule'
        : error instanceof Error
          ? error.message
          : 'Failed to schedule';
      toast.error(msg);
      throw error;
    } finally {
      setScheduling(false);
    }
  };

  const handleSyncInbound = async () => {
    setSyncingInbound(true);
    try {
      const result = await syncInboundFromTwilio(100);
      if (result.imported + result.updated === 0) {
        toast.error(
          result.scanned === 0
            ? 'Twilio returned no messages. Check TWILIO credentials on the server.'
            : `Scanned ${result.scanned} Twilio message(s) but none were inbound replies yet.`,
        );
      } else {
        toast.success(
          `Pulled from Twilio: ${result.imported} new, ${result.updated} updated`,
        );
      }
      setTab('messages');
      await fetchMessages();
    } catch (error) {
      console.error(error);
      let msg = isAxiosError(error)
        ? error.response?.data?.error || error.message || 'Failed to pull replies'
        : error instanceof Error
          ? error.message
          : 'Failed to pull replies';
      if (isAxiosError(error) && error.response?.status === 404) {
        msg =
          'Pull is not on the live API yet. Redeploy/restart the backend, then try again.';
      }
      toast.error(String(msg));
    } finally {
      setSyncingInbound(false);
    }
  };

  const isFlagTab = tab === 'flags';
  const isCannedTab = tab === 'canned';
  const isInboxTab = tab === 'inbox';
  const isChatTab = tab === 'messages';
  const isScheduledTab = tab === 'scheduled';
  const showSmsTools = isChatTab || isScheduledTab;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          mb: 1.5,
          minHeight: 40,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <SmsIcon color="primary" sx={{ fontSize: 32 }} />
          <Typography variant="h5" component="h1">
            Messages
          </Typography>
        </Box>
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            visibility: showSmsTools ? 'visible' : 'hidden',
            pointerEvents: showSmsTools ? 'auto' : 'none',
          }}
        >
          {isAdmin() ? (
            <Button
              size="small"
              variant="outlined"
              onClick={() => void handleSyncInbound()}
              disabled={loadingLists || syncingInbound}
              startIcon={syncingInbound ? <CircularProgress size={16} /> : undefined}
            >
              Pull replies from Twilio
            </Button>
          ) : null}
          <Button
            size="small"
            startIcon={loadingLists ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={() => void fetchMessages()}
            disabled={loadingLists || syncingInbound}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 1.5 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons={false}
          allowScrollButtonsMobile={false}
          sx={{
            minHeight: 44,
            '& .MuiTab-root': {
              minHeight: 44,
              minWidth: 0,
              px: 1.75,
              textTransform: 'none',
            },
          }}
        >
          <Tab value="messages" label="Conversations" />
          <Tab value="scheduled" label={`Scheduled (${lists.scheduled.length})`} />
          {admin ? <Tab value="inbox" label="Team Inbox" /> : null}
          <Tab value="flags" label="Flag messages" />
          <Tab value="canned" label="Canned messages" />
        </Tabs>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
        {isFlagTab
          ? 'Save texts that appear when a job is dragged onto a pipeline column. Send still requires your approval, then an Are you sure confirm.'
          : isCannedTab
            ? 'Save texts you can send from a job card. Placeholders fill from the customer, emails, phone, address, and job already on that card.'
            : isInboxTab
              ? 'Team Outlook worksheets and mail. Create a pipeline job from a worksheet, or dismiss it when it is handled.'
              : isScheduledTab
                ? 'Texts waiting to go out. Send and replies live in the Conversations tab.'
                : 'Conversations look like a phone thread. Replies sit on the left, your texts on the right.'}
      </Typography>

      {isFlagTab ? (
        <FlagMessagesPanel />
      ) : isCannedTab ? (
        <CannedMessagesPanel />
      ) : isInboxTab ? (
        <TeamInboxPanel embedded />
      ) : isScheduledTab ? (
        <MessageTable
          rows={lists.scheduled}
          tab="scheduled"
          loading={loadingLists}
          onOpenRow={(row) => void handleOpenMessage(row, 'scheduled')}
          onDeleteRow={(row) => handleDeleteMessage(row, 'scheduled')}
        />
      ) : (
        <>
          <SmsConversationView
            sent={lists.sent}
            received={lists.received}
            scheduled={lists.scheduled}
            loading={loadingLists}
            sending={sending}
            scheduling={scheduling}
            onSend={handleSend}
            onSchedule={handleSchedule}
            onOpenMessage={handleOpenChatMessage}
            onOpenConversation={handleOpenConversation}
            onDeleteConversation={handleDeleteConversation}
          />
          {lists.sent.length + lists.received.length >= listLimit && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              {listLimit >= LIST_MAX ? (
                <Typography variant="body2" color="text.secondary">
                  Showing the {LIST_MAX.toLocaleString()} most recent messages.
                </Typography>
              ) : (
                <Button
                  variant="outlined"
                  disabled={loadingLists}
                  onClick={() => setListLimit((prev) => Math.min(prev + LIST_PAGE_SIZE, LIST_MAX))}
                >
                  Load more
                </Button>
              )}
            </Box>
          )}
        </>
      )}

      <MessageDetailDialog
        open={detailOpen}
        detail={selectedDetail}
        loading={detailLoading}
        deleting={deleting}
        onClose={handleCloseDetail}
        onDelete={() => {
          if (!selectedDetail) return;
          const tabKey =
            selectedDetail.direction === 'inbound'
              ? 'received'
              : selectedDetail.recordType === 'scheduled'
                ? 'scheduled'
                : 'sent';
          handleDeleteMessage(selectedDetail, tabKey);
          handleCloseDetail();
        }}
      />

      <Dialog open={Boolean(pendingDelete)} onClose={() => (deleting ? null : setPendingDelete(null))} maxWidth="xs" fullWidth>
        <DialogTitle>
          {pendingDelete?.kind === 'conversation' ? 'Delete conversation?' : 'Delete this message?'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {pendingDelete?.kind === 'conversation'
              ? `Remove the thread with ${pendingDelete.label} from Paarth. It does not unsend texts that already went out.`
              : 'Remove this text from Paarth. It does not unsend anything already delivered.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default MessagePage;
