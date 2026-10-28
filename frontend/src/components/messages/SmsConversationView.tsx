import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  DeleteOutline as DeleteOutlineIcon,
  DriveFileRenameOutline as RenameIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  Image as ImageIcon,
  Schedule as ScheduleIcon,
  Send as SendIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import { useTheme } from '@mui/material/styles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { formatPhoneForDisplay } from '../../utils/phoneFormat';
import type { SmsRow } from '../../utils/twilioApi';
import SmsMessagePhotos from './SmsMessagePhotos';
import api from '../../utils/axios';
import { useSocketSubscription } from '../../hooks/useSocketSubscription';
import { getTenantRoom } from '../../services/socket';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import {
  conversationPhoneKey,
  loadConversationAliases,
  mergeConversationNames,
  namesFromCustomers,
  namesFromEmployees,
  setConversationAlias,
} from '../../utils/smsConversationNames';

export type ChatDirection = 'inbound' | 'outbound';

export type ChatMessage = SmsRow & { direction: ChatDirection };

type Conversation = {
  key: string;
  phone: string;
  displayPhone: string;
  customerName: string;
  messages: ChatMessage[];
  lastAt: number;
  unreadCount: number;
  lastPreview: string;
};

function partyPhone(row: SmsRow, direction: ChatDirection) {
  return String(direction === 'inbound' ? row.from : row.to || '').trim();
}

function conversationKey(phone: string) {
  return conversationPhoneKey(phone);
}

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

function formatListTime(value: number) {
  if (!value) return '';
  const d = new Date(value);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'M/d/yy');
}

function deliveryLabel(row: ChatMessage) {
  const status = String(row.deliveryStatus || row.status || '').toLowerCase();
  if (row.direction === 'inbound') return row.status === 'unread' ? 'Unread' : '';
  if (status === 'failed' || status === 'undelivered') return 'Not delivered';
  if (status === 'scheduled') return row.sendAt ? `Scheduled ${formatThreadTime(row.sendAt)}` : 'Scheduled';
  if (status === 'delivered' || row.deliveredAt) return 'Delivered';
  if (status === 'sent' || status === 'read') return 'Sent';
  if (status === 'queued' || status === 'sending') return 'Sending';
  return '';
}

export function buildConversations(
  sent: SmsRow[],
  received: SmsRow[],
  scheduled: SmsRow[] = [],
  nameByPhone: Record<string, string> = {},
): Conversation[] {
  const byKey = new Map<string, Conversation>();

  const add = (row: SmsRow, direction: ChatDirection) => {
    const phone = partyPhone(row, direction);
    const key = conversationKey(phone);
    const existing = byKey.get(key);
    const message: ChatMessage = { ...row, direction };
    if (existing) {
      existing.messages.push(message);
      return;
    }
    byKey.set(key, {
      key,
      phone: phone || key,
      displayPhone: formatPhoneForDisplay(phone) || phone || 'Unknown',
      customerName: nameByPhone[key] || '',
      messages: [message],
      lastAt: 0,
      unreadCount: 0,
      lastPreview: '',
    });
  };

  sent.forEach((row) => add(row, 'outbound'));
  received.forEach((row) => add(row, 'inbound'));
  scheduled
    .filter((row) => String(row.status || '').toLowerCase() === 'scheduled')
    .forEach((row) => add(row, 'outbound'));

  return Array.from(byKey.values())
    .map((conv) => {
      const messages = [...conv.messages].sort((a, b) => messageTime(a) - messageTime(b));
      const last = messages[messages.length - 1];
      return {
        ...conv,
        customerName: nameByPhone[conv.key] || conv.customerName || '',
        messages,
        lastAt: last ? messageTime(last) : 0,
        unreadCount: messages.filter((row) => row.direction === 'inbound' && row.status === 'unread').length,
        lastPreview: last?.body || (last?.media?.length ? 'Photo' : ''),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

export default function SmsConversationView({
  sent,
  received,
  scheduled,
  loading,
  sending,
  scheduling,
  onSend,
  onSchedule,
  onOpenMessage,
  onOpenConversation,
  onDeleteConversation,
}: {
  sent: SmsRow[];
  received: SmsRow[];
  scheduled: SmsRow[];
  loading: boolean;
  sending: boolean;
  scheduling: boolean;
  onSend: (to: string, message: string, photo?: File | null) => Promise<void>;
  onSchedule: (to: string, message: string, sendAtLocal: string) => Promise<void>;
  onOpenMessage: (row: ChatMessage) => void;
  onOpenConversation?: (unreadIds: string[]) => void;
  onDeleteConversation?: (phone: string, label: string) => void;
}) {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const isDark = theme.palette.mode === 'dark';
  const { tenantIdForBranding } = useAuth();
  const tenantKey = tenantIdForBranding ? String(tenantIdForBranding) : '';
  const [directoryNames, setDirectoryNames] = useState<Record<string, string>>({});
  const [aliases, setAliases] = useState<Record<string, string>>(() => loadConversationAliases(tenantKey));
  const nameByPhone = useMemo(
    () => mergeConversationNames(directoryNames, aliases),
    [directoryNames, aliases],
  );
  const conversations = useMemo(
    () => buildConversations(sent, received, scheduled, nameByPhone),
    [sent, received, scheduled, nameByPhone],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const [toDisplay, setToDisplay] = useState('');
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    left: number;
    top: number;
    conv: Conversation;
  } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameKey, setRenameKey] = useState('');
  const [syncingNames, setSyncingNames] = useState(false);
  const [sendAtLocal, setSendAtLocal] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const threadRef = useRef<HTMLDivElement | null>(null);
  const markedUnreadRef = useRef('');
  const selected = conversations.find((row) => row.key === selectedKey) || null;
  const showList = !isMobile || (!selected && !composingNew);
  const showThread = !isMobile || Boolean(selected) || composingNew;
  const recipient = composingNew || !selected
    ? toDisplay.trim()
    : String(selected.phone || selected.displayPhone || toDisplay).trim();

  const loadDirectoryNames = useCallback(async () => {
    setAliases(loadConversationAliases(tenantKey));
    try {
      const [customersRes, employeesRes] = await Promise.all([
        api.get('/customers', { params: { limit: 1000 } }),
        api.get('/users/employees-for-sms').catch(() => ({ data: {} })),
      ]);
      const customers = Array.isArray(customersRes.data?.customers) ? customersRes.data.customers : [];
      const employees = Array.isArray(employeesRes.data?.recipients)
        ? employeesRes.data.recipients
        : Array.isArray(employeesRes.data?.employees)
          ? employeesRes.data.employees
          : [];
      setDirectoryNames({
        ...namesFromCustomers(customers),
        ...namesFromEmployees(employees),
      });
    } catch {
      /* names stay as phone numbers or saved aliases */
    }
  }, [tenantKey]);

  useEffect(() => {
    void loadDirectoryNames();
  }, [loadDirectoryNames]);

  useSocketSubscription(
    tenantIdForBranding ? getTenantRoom(tenantIdForBranding) : null,
    'customer.changed',
    loadDirectoryNames,
  );

  useEffect(() => {
    if (composingNew) return;
    if (selectedKey && conversations.some((row) => row.key === selectedKey)) return;
    if (!isMobile && conversations[0]) setSelectedKey(conversations[0].key);
  }, [conversations, selectedKey, composingNew, isMobile]);

  useEffect(() => {
    if (composingNew || !selected) return;
    setToDisplay((prev) => (prev === selected.displayPhone ? prev : selected.displayPhone));
  }, [composingNew, selected]);

  useEffect(() => {
    if (composingNew || !selected) return;
    const unreadIds = selected.messages
      .filter((row) => row.direction === 'inbound' && row.status === 'unread')
      .map((row) => row.id);
    if (!unreadIds.length) return;
    const stamp = `${selected.key}:${[...unreadIds].sort().join(',')}`;
    if (markedUnreadRef.current === stamp) return;
    markedUnreadRef.current = stamp;
    onOpenConversation?.(unreadIds);
  }, [composingNew, selected, onOpenConversation]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [selectedKey, selected?.messages.length, composingNew]);

  const openConversation = (conv: Conversation) => {
    setComposingNew(false);
    setSelectedKey(conv.key);
    setToDisplay(conv.displayPhone);
    setBody('');
    setScheduleMode(false);
  };

  const openContextMenu = (event: MouseEvent, conv: Conversation) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ left: event.clientX, top: event.clientY, conv });
  };

  const closeContextMenu = () => setContextMenu(null);

  const startRename = (conv: Conversation) => {
    setRenameKey(conv.key);
    setRenameValue(conv.customerName || conv.displayPhone);
    setRenameOpen(true);
    closeContextMenu();
  };

  const saveRename = () => {
    if (!renameKey) return;
    const next = setConversationAlias(tenantKey, renameKey, renameValue);
    setAliases(next);
    setRenameOpen(false);
    toast.success('Conversation name saved');
  };

  const useDirectoryName = (conv: Conversation) => {
    const next = setConversationAlias(tenantKey, conv.key, '');
    setAliases(next);
    closeContextMenu();
    const live = directoryNames[conv.key];
    if (live) toast.success(`Using ${live}`);
    else toast('No customer or employee match for this number yet');
  };

  const refreshAllNames = async () => {
    setSyncingNames(true);
    try {
      await loadDirectoryNames();
      toast.success('Names refreshed from customers and the employee list');
    } finally {
      setSyncingNames(false);
    }
  };

  const startNew = () => {
    setComposingNew(true);
    setSelectedKey(null);
    setToDisplay('');
    setBody('');
    setScheduleMode(false);
  };

  const backToList = () => {
    setComposingNew(false);
    setSelectedKey(null);
  };

  const busy = sending || scheduling;
  const canSend = Boolean(recipient && (body.trim() || (photo && !scheduleMode)) && !busy);

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
    if (!canSend) return;
    const to = recipient;
    const message = body.trim();
    const attachment = photo;
    try {
      await onSend(to, message, attachment);
      setBody('');
      clearPhoto();
      setComposingNew(false);
      setSelectedKey(conversationKey(to));
    } catch {
      /* parent already showed the error */
    }
  };

  const handleSchedule = async () => {
    if (!canSend || !sendAtLocal) return;
    try {
      await onSchedule(recipient, body.trim(), sendAtLocal);
      setBody('');
      setScheduleMode(false);
      setComposingNew(false);
      setSelectedKey(conversationKey(recipient));
    } catch {
      /* parent already showed the error */
    }
  };

  const outboundBg = theme.palette.primary.main;
  const outboundColor = theme.palette.primary.contrastText;
  const inboundBg = isDark ? 'rgba(255,255,255,0.12)' : '#E9E9EB';
  const inboundColor = theme.palette.text.primary;

  return (
    <>
    <Paper
      variant="outlined"
      sx={{
        display: 'flex',
        height: { xs: 'calc(100vh - 220px)', md: 'calc(100vh - 240px)' },
        minHeight: 520,
        overflow: 'hidden',
      }}
    >
      {showList ? (
        <Box
          sx={{
            width: { xs: '100%', md: 300 },
            flexShrink: 0,
            borderRight: { md: 1 },
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'grey.50',
          }}
        >
          <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Conversations
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Tooltip title="Refresh names from customers and employees">
                <span>
                  <IconButton size="small" onClick={() => void refreshAllNames()} disabled={syncingNames} aria-label="Refresh names">
                    {syncingNames ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Button size="small" startIcon={<EditIcon />} onClick={startNew} sx={{ textTransform: 'none' }}>
                New
              </Button>
            </Box>
          </Box>
          {loading && conversations.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} />
            </Box>
          ) : conversations.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 3 }}>
              No texts yet. Start a new conversation.
            </Typography>
          ) : (
            <List dense disablePadding sx={{ overflow: 'auto', flex: 1 }}>
              {conversations.map((conv) => (
                <ListItemButton
                  key={conv.key}
                  selected={conv.key === selectedKey && !composingNew}
                  onClick={() => openConversation(conv)}
                  onContextMenu={(event) => openContextMenu(event, conv)}
                  sx={{
                    alignItems: 'flex-start',
                    py: 1.25,
                    '&:hover .conv-delete': { opacity: 1 },
                  }}
                >
                  <ListItemText
                    primary={conv.customerName || conv.displayPhone}
                    secondary={
                      conv.customerName
                        ? [conv.displayPhone, conv.lastPreview].filter(Boolean).join(' · ')
                        : conv.lastPreview || ' '
                    }
                    primaryTypographyProps={{ fontWeight: conv.unreadCount ? 700 : 600, noWrap: true }}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                  <Box sx={{ ml: 1, textAlign: 'right', flexShrink: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {formatListTime(conv.lastAt)}
                    </Typography>
                    {conv.unreadCount > 0 ? (
                      <Box
                        sx={{
                          mt: 0.5,
                          ml: 'auto',
                          minWidth: 20,
                          height: 20,
                          px: 0.75,
                          borderRadius: 10,
                          bgcolor: 'error.main',
                          color: 'error.contrastText',
                          fontSize: 11,
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {conv.unreadCount}
                      </Box>
                    ) : null}
                    {onDeleteConversation ? (
                      <IconButton
                        className="conv-delete"
                        size="small"
                        aria-label={`Delete conversation with ${conv.customerName || conv.displayPhone}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteConversation(conv.phone, conv.customerName || conv.displayPhone);
                        }}
                        sx={{
                          mt: 0.25,
                          opacity: { xs: 1, md: 0 },
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    ) : null}
                  </Box>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      ) : null}

      {showThread ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: 1,
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              minHeight: 56,
            }}
          >
            {isMobile ? (
              <IconButton size="small" onClick={backToList} aria-label="Back to conversations">
                <ArrowBackIcon />
              </IconButton>
            ) : null}
            <Box
              sx={{ flex: 1, minWidth: 0 }}
              onContextMenu={selected && !composingNew ? (event) => openContextMenu(event, selected) : undefined}
            >
              {composingNew || !selected ? (
                <TextField
                  size="small"
                  fullWidth
                  label="To"
                  value={toDisplay}
                  onChange={(e) => setToDisplay(e.target.value)}
                  placeholder="(949) 555-0100"
                  autoComplete="tel"
                />
              ) : (
                <>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
                    {selected.customerName || selected.displayPhone}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selected.customerName ? selected.displayPhone : 'Text messages'}
                  </Typography>
                </>
              )}
            </Box>
            {selected && !composingNew && onDeleteConversation ? (
              <IconButton
                aria-label="Delete conversation"
                onClick={() => onDeleteConversation(selected.phone, selected.customerName || selected.displayPhone)}
              >
                <DeleteOutlineIcon />
              </IconButton>
            ) : null}
          </Box>

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
            {loading && !selected?.messages.length && !composingNew ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress size={24} />
              </Box>
            ) : selected?.messages.length ? (
              selected.messages.map((row, index) => {
                const when = row.sentAt || row.sendAt || row.createdAt;
                const prev = selected.messages[index - 1];
                const prevWhen = prev ? prev.sentAt || prev.sendAt || prev.createdAt : null;
                const showDay =
                  !prevWhen ||
                  !when ||
                  !isSameDay(new Date(when), new Date(prevWhen));
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
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: outbound ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <Box
                        component="button"
                        type="button"
                        onClick={() => onOpenMessage(row)}
                        sx={{
                          all: 'unset',
                          cursor: 'pointer',
                          maxWidth: '78%',
                          px: 1.5,
                          py: 1,
                          borderRadius: outbound ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                          bgcolor: failed ? 'error.main' : outbound ? outboundBg : inboundBg,
                          color: failed ? 'error.contrastText' : outbound ? outboundColor : inboundColor,
                          boxShadow: outbound ? 'none' : isDark ? 'none' : '0 1px 1px rgba(0,0,0,0.06)',
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
                {composingNew ? 'Type a number and message to start the thread.' : 'Select a conversation.'}
              </Typography>
            )}
          </Box>

          <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
            {scheduleMode ? (
              <TextField
                label="Send at"
                type="datetime-local"
                size="small"
                fullWidth
                value={sendAtLocal}
                onChange={(e) => setSendAtLocal(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ mb: 1 }}
              />
            ) : null}
            {photoPreview ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Box
                  component="img"
                  src={photoPreview}
                  alt="Photo to send"
                  sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1 }}
                />
                <Button size="small" onClick={clearPhoto} disabled={busy}>
                  Remove photo
                </Button>
              </Box>
            ) : null}
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
              <IconButton
                onClick={() => photoInputRef.current?.click()}
                aria-label="Attach photo"
                disabled={busy || scheduleMode}
              >
                <ImageIcon />
              </IconButton>
              <IconButton
                color={scheduleMode ? 'primary' : 'default'}
                onClick={() =>
                  setScheduleMode((prev) => {
                    if (!prev) clearPhoto();
                    return !prev;
                  })
                }
                aria-label="Schedule message"
                disabled={busy}
              >
                <ScheduleIcon />
              </IconButton>
              <TextField
                placeholder="Text message"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                fullWidth
                multiline
                minRows={3}
                maxRows={8}
                disabled={busy}
                inputProps={{ maxLength: 1500 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (scheduleMode) void handleSchedule();
                    else void handleSend();
                  }
                }}
              />
              <IconButton
                color="primary"
                onClick={() => (scheduleMode ? void handleSchedule() : void handleSend())}
                disabled={!canSend}
                aria-label={scheduleMode ? 'Schedule message' : 'Send message'}
              >
                {busy ? <CircularProgress size={20} /> : <SendIcon />}
              </IconButton>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Paper>
    <Menu
      open={Boolean(contextMenu)}
      onClose={closeContextMenu}
      anchorReference="anchorPosition"
      anchorPosition={
        contextMenu ? { top: contextMenu.top, left: contextMenu.left } : undefined
      }
    >
      <MenuItem
        onClick={() => {
          if (contextMenu) startRename(contextMenu.conv);
        }}
      >
        <ListItemIcon>
          <RenameIcon fontSize="small" />
        </ListItemIcon>
        Rename
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (contextMenu) useDirectoryName(contextMenu.conv);
        }}
      >
        <ListItemIcon>
          <SyncIcon fontSize="small" />
        </ListItemIcon>
        Use customer / employee name
      </MenuItem>
    </Menu>
    <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Conversation name</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Name"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          sx={{ mt: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              saveRename();
            }
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
        <Button variant="contained" onClick={saveRename} disabled={!renameValue.trim()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
}
