import { useState, useRef, useEffect } from 'react';
import {
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  IconButton,
  CircularProgress,
} from '@mui/material';
import { Chat as ChatIcon, Close as CloseIcon, Send as SendIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../utils/axios';
import { applyJobOverlayActions, parseJobOverlayPath } from '../../voice/jobOverlayBus';
import { applyMapShow, parseMapShowAction, startMapTour } from '../../voice/mapCommandBus';

export default function SiteAssistantChat() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      const { data } = await api.post('/assistant/chat', { messages: nextMessages });
      const reply = typeof data?.reply === 'string' ? data.reply : '';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply || '—' }]);

      const actions = Array.isArray(data?.actions) ? data.actions : [];
      const mapShow = parseMapShowAction(actions.find((row) => row?.type === 'map_show'));
      if (mapShow) {
        applyMapShow(mapShow);
        if (mapShow.path) navigate(mapShow.path);
        if (mapShow.jobIds.length) {
          const duration = Math.max(4000, mapShow.jobIds.length * 2400);
          const stopTour = startMapTour(mapShow.jobIds, duration);
          window.setTimeout(stopTour, duration);
        }
      }
      applyJobOverlayActions(actions);
      for (const a of actions) {
        if (a?.type === 'navigate' && typeof a.path === 'string' && !parseJobOverlayPath(a.path)) {
          navigate(a.path);
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Assistant failed';
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            err.response?.status === 503
              ? 'The assistant is not set up on the server yet (missing API key). Ask your administrator to configure OPENAI_API_KEY.'
              : `Something went wrong: ${msg}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Fab
        color="primary"
        aria-label="Open help assistant"
        onClick={() => setOpen(true)}
        sx={{
          position: 'fixed',
          right: { xs: 16, sm: 24 },
          bottom: { xs: 16, sm: 24 },
          zIndex: (t) => t.zIndex.drawer + 2,
        }}
      >
        <ChatIcon />
      </Fab>

      <Dialog
        open={open}
        onClose={() => !sending && setOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: { sx: { height: { xs: '85vh', sm: 520 }, maxHeight: 560 } },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
          <Typography component="span" variant="h6" sx={{ fontWeight: 600 }}>
            Paarth help
          </Typography>
          <IconButton aria-label="Close" onClick={() => !sending && setOpen(false)} disabled={sending} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', p: 0, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
            <Typography variant="body2" color="text.secondary">
              Answers use your organization&apos;s live data: payments, deposits, job notes, search, and navigation.
              Not legal or financial advice.
            </Typography>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2 }}>
            {messages.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Try: &ldquo;What was the most recent payment?&rdquo;, &ldquo;What materials do I need to order?&rdquo;,
                &ldquo;Search notes for hardware&rdquo;, or &ldquo;Take me to finance&rdquo;.
              </Typography>
            )}
            {messages.map((m, i) => (
              <Box
                key={i}
                sx={{
                  mb: 1.5,
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <Box
                  sx={{
                    maxWidth: '92%',
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    bgcolor: m.role === 'user' ? 'primary.main' : 'action.hover',
                    color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    typography: 'body2',
                  }}
                >
                  {m.content}
                </Box>
              </Box>
            ))}
            {sending && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-start', py: 1 }}>
                <CircularProgress size={22} />
              </Box>
            )}
            <div ref={endRef} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.5, alignItems: 'stretch', gap: 1 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Ask about payments, deposits, job notes…"
            autoFocus={open}
            value={input}
            disabled={sending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            multiline
            maxRows={3}
          />
          <Button
            variant="contained"
            onClick={handleSend}
            disabled={sending || !input.trim()}
            sx={{ minWidth: 48, px: 1 }}
            aria-label="Send"
          >
            {sending ? <CircularProgress size={22} color="inherit" /> : <SendIcon />}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
