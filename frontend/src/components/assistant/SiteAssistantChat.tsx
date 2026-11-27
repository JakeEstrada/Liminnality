import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Chat as ChatIcon, Close as CloseIcon, Send as SendIcon, Mic as MicIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../utils/axios';
import { applyJobOverlayActions, parseJobOverlayPath } from '../../voice/jobOverlayBus';
import { applyMapShow, parseMapShowAction, startMapTour } from '../../voice/mapCommandBus';
import {
  cancelSpeech,
  collectTranscript,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  speakText,
} from '../../voice/browserSpeech';
import { unlockNeuralAudio } from '../../voice/neuralSpeech';
import { spokenAssistantReply } from '../../voice/assistantVoice';
import { HELP_GREETING_REPLY, isHelpGreeting, isHelpVoiceStop } from '../../voice/helpVoice';
import { claimMicrophone, releaseMicrophone } from '../../voice/micClaim';

const voiceSupported = typeof window !== 'undefined' && isSpeechRecognitionSupported();

export default function SiteAssistantChat() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voicePhase, setVoicePhase] = useState('idle');
  const [heard, setHeard] = useState('');
  const endRef = useRef(null);
  const messagesRef = useRef(messages);
  const voiceWantedRef = useRef(false);
  const busyRef = useRef(false);
  const recognitionRef = useRef(null);
  const endpointRef = useRef(null);
  const sendRef = useRef<(text: string, speak: boolean) => Promise<void>>(async () => {});

  messagesRef.current = messages;

  const releaseRecognition = useCallback(() => {
    if (endpointRef.current) window.clearTimeout(endpointRef.current);
    endpointRef.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const endVoice = useCallback(() => {
    voiceWantedRef.current = false;
    setVoiceOn(false);
    setVoicePhase('idle');
    setHeard('');
    cancelSpeech();
    releaseRecognition();
    releaseMicrophone('help');
  }, [releaseRecognition]);

  const startListening = useCallback(() => {
    if (!voiceWantedRef.current || busyRef.current) return;
    releaseRecognition();
    const recognition = createSpeechRecognition();
    if (!recognition) {
      toast.error('This browser cannot use the microphone.');
      voiceWantedRef.current = false;
      setVoiceOn(false);
      setVoicePhase('idle');
      return;
    }
    recognitionRef.current = recognition;
    setVoicePhase('listening');
    recognition.onresult = (event) => {
      if (!voiceWantedRef.current || busyRef.current) return;
      const { finalText, interimText } = collectTranscript(event);
      const spoken = String(finalText || interimText || '').trim();
      if (spoken) setHeard(spoken);
      if (!spoken) return;
      if (endpointRef.current) window.clearTimeout(endpointRef.current);
      endpointRef.current = window.setTimeout(() => {
        endpointRef.current = null;
        if (!voiceWantedRef.current || busyRef.current) return;
        setHeard('');
        if (isHelpVoiceStop(spoken)) {
          endVoice();
          return;
        }
        void sendRef.current(spoken, true);
      }, finalText ? 250 : 900);
    };
    recognition.onerror = (event) => {
      const error = String(event?.error || '');
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        toast.error('The microphone is blocked. Allow it for this site, then press Talk again.');
        endVoice();
        return;
      }
      if (error === 'network') {
        setHeard('Speech did not come through. Say it once more, or type it.');
      }
    };
    recognition.onend = () => {
      if (!voiceWantedRef.current || busyRef.current || recognitionRef.current !== recognition) return;
      window.setTimeout(() => {
        if (!voiceWantedRef.current || busyRef.current || recognitionRef.current !== recognition) return;
        try {
          recognition.start();
        } catch {
          /* already running */
        }
      }, 120);
    };
    try {
      recognition.start();
    } catch {
      toast.error('The microphone did not start.');
      endVoice();
    }
  }, [endVoice, releaseRecognition]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, open, heard]);

  useEffect(() => () => {
    voiceWantedRef.current = false;
    cancelSpeech();
    releaseRecognition();
    releaseMicrophone('help');
  }, [releaseRecognition]);

  const applyActions = useCallback((actions) => {
    const list = Array.isArray(actions) ? actions : [];
    const mapShow = parseMapShowAction(list.find((row) => row?.type === 'map_show'));
    if (mapShow) {
      applyMapShow(mapShow);
      if (mapShow.path) navigate(mapShow.path);
      if (mapShow.jobIds.length) {
        const duration = Math.max(4000, mapShow.jobIds.length * 2400);
        const stopTour = startMapTour(mapShow.jobIds, duration);
        window.setTimeout(stopTour, duration);
      }
    }
    applyJobOverlayActions(list);
    for (const action of list) {
      if (action?.type === 'navigate' && typeof action.path === 'string' && !parseJobOverlayPath(action.path)) {
        navigate(action.path);
      }
    }
  }, [navigate]);

  const sendMessage = useCallback(async (text, speak) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || busyRef.current) return;
    busyRef.current = true;
    if (speak) releaseRecognition();
    setSending(true);
    if (speak) setVoicePhase('thinking');
    const nextMessages = [...messagesRef.current, { role: 'user', content: trimmed }];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    setHeard('');

    try {
      let raw = '';
      let actions = [];
      if (isHelpGreeting(trimmed)) {
        raw = HELP_GREETING_REPLY;
      } else {
        const pagePath = `${window.location.pathname}${window.location.search}`;
        const { data } = await api.post('/assistant/chat', {
          messages: nextMessages,
          voice: speak,
          pagePath,
        });
        raw = typeof data?.reply === 'string' ? data.reply : '';
        actions = data?.actions;
      }
      const reply = speak ? spokenAssistantReply(raw) : raw;
      const withReply = [...nextMessages, { role: 'assistant', content: reply || '—' }];
      messagesRef.current = withReply;
      setMessages(withReply);
      applyActions(actions);
      if (speak && reply && voiceWantedRef.current) {
        setVoicePhase('speaking');
        try {
          await speakText(reply);
        } catch {
          toast.error('The answer is in the chat. The voice did not play.');
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Assistant failed';
      const stopped = /too many tool rounds/i.test(String(msg));
      if (!stopped) toast.error(msg);
      const content = err.response?.status === 503
        ? 'The assistant is not set up on the server yet (missing API key). Ask your administrator to configure OPENAI_API_KEY.'
        : stopped
          ? HELP_GREETING_REPLY
          : `Something went wrong: ${msg}`;
      const failed = [...nextMessages, { role: 'assistant', content }];
      messagesRef.current = failed;
      setMessages(failed);
      if (speak && stopped && voiceWantedRef.current) {
        setVoicePhase('speaking');
        try {
          await speakText(content);
        } catch {
          /* the reply is already on screen */
        }
      }
    } finally {
      busyRef.current = false;
      setSending(false);
      if (voiceWantedRef.current) startListening();
      else setVoicePhase('idle');
    }
  }, [applyActions, releaseRecognition, startListening]);

  sendRef.current = sendMessage;

  const closeChat = () => {
    if (sending && !voiceOn) return;
    endVoice();
    setOpen(false);
  };

  const toggleVoice = () => {
    if (voiceOn) {
      endVoice();
      return;
    }
    if (!voiceSupported) {
      toast.error('Voice needs Chrome, or the shop microphone on this computer.');
      return;
    }
    unlockNeuralAudio();
    claimMicrophone('help');
    voiceWantedRef.current = true;
    setVoiceOn(true);
    startListening();
  };

  const voiceStatus = voicePhase === 'listening'
    ? (heard ? `Hearing: ${heard}` : 'Listening. Say stop when you are done.')
    : voicePhase === 'thinking'
      ? 'Thinking'
      : voicePhase === 'speaking'
        ? 'Speaking'
        : '';

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
        onClose={closeChat}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: { sx: { height: { xs: '85vh', sm: 560 }, maxHeight: 640 } },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
          <Typography component="span" variant="h6" sx={{ fontWeight: 600 }}>
            Liminnality help
          </Typography>
          <IconButton aria-label="Close" onClick={closeChat} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', p: 0, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
            <Typography variant="body2" color="text.secondary">
              Press Talk and speak. Liminality answers out loud, then listens for the next question.
              You can also type. Answers use your notes, tasks, worksheet details, and the rest of the shop data.
            </Typography>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2 }}>
            {messages.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Try: &ldquo;What jobs did I order balusters for last week?&rdquo;, &ldquo;What is a vector?&rdquo;,
                or &ldquo;What was the most recent payment?&rdquo;
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
            {sending && voicePhase !== 'speaking' && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-start', py: 1 }}>
                <CircularProgress size={22} />
              </Box>
            )}
            <div ref={endRef} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.5, alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant={voiceOn ? 'contained' : 'outlined'}
            color={voiceOn ? 'error' : 'primary'}
            onClick={toggleVoice}
            startIcon={<MicIcon />}
            aria-label={voiceOn ? 'End voice chat' : 'Talk with Liminality'}
            aria-pressed={voiceOn}
            sx={{ minWidth: 104 }}
          >
            {voiceOn ? 'End' : 'Talk'}
          </Button>
          <TextField
            fullWidth
            size="small"
            placeholder={voiceOn ? 'Listening… or type a question' : 'Ask about payments, jobs, or how search works'}
            autoFocus={open && !voiceOn}
            value={voiceOn && heard ? heard : input}
            disabled={sending && !voiceOn}
            onChange={(e) => {
              if (voiceOn && heard) return;
              setInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(input, voiceOn);
              }
            }}
            multiline
            maxRows={3}
            sx={{ flex: 1, minWidth: 160 }}
          />
          <Button
            variant="contained"
            onClick={() => void sendMessage(input, voiceOn)}
            disabled={sending || !input.trim()}
            sx={{ minWidth: 48, px: 1 }}
            aria-label="Send"
          >
            {sending && !voiceOn ? <CircularProgress size={22} color="inherit" /> : <SendIcon />}
          </Button>
          {voiceStatus ? (
            <Typography variant="caption" color="text.secondary" sx={{ width: '100%', px: 0.5 }}>
              {voiceStatus}
            </Typography>
          ) : null}
        </DialogActions>
      </Dialog>
    </>
  );
}
