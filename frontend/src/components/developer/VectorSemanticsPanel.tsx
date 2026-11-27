import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MicIcon from '@mui/icons-material/Mic';
import SendIcon from '@mui/icons-material/Send';
import toast from 'react-hot-toast';
import api from '../../utils/axios';
import {
  cancelSpeech,
  collectTranscript,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  speakText,
} from '../../voice/browserSpeech';
import { unlockNeuralAudio } from '../../voice/neuralSpeech';
import { claimMicrophone, releaseMicrophone } from '../../voice/micClaim';

type Line = {
  memoryId: string;
  jobId: string;
  jobTitle: string;
  customerName?: string | null;
  kindLabel: string;
  excerpt: string;
  score?: number | null;
};

type Example = Line & {
  dimensions: number;
  previewText: string;
  text: string;
};

type JobRow = {
  jobId: string;
  memoryId: string;
  jobTitle: string;
  customerName?: string | null;
  lineCount: number;
  noteDate?: string | null;
};

type VectorPage = {
  empty?: boolean;
  model?: string;
  storedLines?: number;
  jobCount?: number;
  order?: string;
  jobs?: JobRow[];
  example?: Example | null;
  neighbors?: Line[];
  sameJob?: Line[];
  detail?: string[];
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const voiceSupported = typeof window !== 'undefined' && isSpeechRecognitionSupported();

function scoreLabel(score: number) {
  if (score >= 0.45) return 'close';
  if (score >= 0.38) return 'loose match';
  return 'weaker than search keeps';
}

export default function VectorSemanticsPanel() {
  const theme = useTheme();
  const outline = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [jobId, setJobId] = useState('');
  const [memoryId, setMemoryId] = useState('');
  const [page, setPage] = useState<VectorPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [listening, setListening] = useState(false);
  const askingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const talkRef = useRef(false);
  const phaseRef = useRef<'listen' | 'busy'>('listen');
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition> | null>(null);
  const pageRef = useRef<VectorPage | null>(null);
  const openedRef = useRef('');

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    try {
      recognition.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const endTalk = useCallback(() => {
    talkRef.current = false;
    phaseRef.current = 'listen';
    releaseMicrophone('vectors');
    cancelSpeech();
    stopRecognition();
    setListening(false);
  }, [stopRecognition]);

  useEffect(() => () => {
    talkRef.current = false;
    releaseMicrophone('vectors');
    cancelSpeech();
    stopRecognition();
  }, [stopRecognition]);

  useEffect(() => {
    if (draft.trim().length < 2) {
      setQuery('');
      return undefined;
    }
    const handle = window.setTimeout(() => setQuery(draft.trim()), 400);
    return () => window.clearTimeout(handle);
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/developer-tasks/vectors', { params: { jobId, memoryId, q: query } })
      .then(({ data }) => {
        if (cancelled) return;
        setPage(data || null);
        pageRef.current = data || null;
        const opened = data?.example?.memoryId || '';
        if (opened !== openedRef.current) {
          openedRef.current = opened;
          setMessages([]);
          messagesRef.current = [];
        }
      })
      .catch((error) => {
        if (cancelled) return;
        const msg = error.response?.data?.error || 'Could not read the stored vectors.';
        toast.error(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, memoryId, query]);

  const ask = useCallback(async (text: string, speak: boolean) => {
    const trimmed = String(text || '').trim();
    const example = pageRef.current?.example;
    if (!trimmed || !example?.memoryId || askingRef.current) return;
    askingRef.current = true;
    setAsking(true);
    phaseRef.current = 'busy';
    setListening(false);
    const history = messagesRef.current;
    const next = [...history, { role: 'user' as const, content: trimmed }];
    messagesRef.current = next;
    setMessages(next);
    setQuestion('');
    try {
      const { data } = await api.post('/developer-tasks/vectors/ask', {
        memoryId: example.memoryId,
        question: trimmed,
        messages: history,
      });
      const reply = typeof data?.reply === 'string' && data.reply.trim()
        ? data.reply.trim()
        : 'I could not read a reason off these lines.';
      const withReply = [...next, { role: 'assistant' as const, content: reply }];
      messagesRef.current = withReply;
      setMessages(withReply);
      if (speak && talkRef.current) {
        try {
          await speakText(reply);
        } catch {
          toast.error('The answer is on the page. The voice did not play.');
        }
      }
    } catch (error) {
      const msg = error.response?.data?.error || 'Could not answer from the stored vectors.';
      toast.error(msg);
    } finally {
      askingRef.current = false;
      setAsking(false);
      if (talkRef.current) {
        phaseRef.current = 'listen';
        setListening(true);
        try {
          recognitionRef.current?.start();
        } catch {
          /* already running */
        }
      } else {
        phaseRef.current = 'listen';
      }
    }
  }, []);

  const startTalk = () => {
    if (talkRef.current) {
      endTalk();
      return;
    }
    if (!voiceSupported) {
      toast.error('Voice needs Chrome, or the shop microphone on this computer.');
      return;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      toast.error('Voice needs Chrome, or the shop microphone on this computer.');
      return;
    }
    unlockNeuralAudio();
    claimMicrophone('vectors');
    recognitionRef.current = recognition;
    talkRef.current = true;
    phaseRef.current = 'listen';
    setListening(true);
    let buffer = '';
    let timer = 0;
    recognition.onresult = (event) => {
      const heard = collectTranscript(event);
      buffer = `${heard.finalText || ''} ${heard.interimText || ''}`.trim();
      window.clearTimeout(timer);
      const wait = heard.finalText ? 250 : 900;
      timer = window.setTimeout(() => {
        if (!talkRef.current || phaseRef.current !== 'listen' || !buffer) return;
        const said = buffer;
        buffer = '';
        void ask(said, true);
      }, wait);
    };
    recognition.onerror = (event) => {
      if (event?.error === 'not-allowed') {
        toast.error('Allow the microphone for this site, then press Talk again.');
        endTalk();
      }
    };
    recognition.onend = () => {
      if (!talkRef.current || phaseRef.current !== 'listen') return;
      window.setTimeout(() => {
        if (!talkRef.current || phaseRef.current !== 'listen') return;
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
      endTalk();
      toast.error('The microphone did not start.');
    }
  };

  const example = page?.example;
  const termSearch = page?.order === 'recent' || page?.order === 'terms';
  const needle = draft.trim().toLowerCase();
  const jobs = termSearch
    ? (page?.jobs || [])
    : (page?.jobs || []).filter((job) => {
      if (!needle) return true;
      return `${job.jobTitle} ${job.customerName || ''}`.toLowerCase().includes(needle);
    });

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every job with a stored vector is in the list. Type words from the worksheet, a part number, or a size. Matching jobs come back newest worksheet date first. Open one to see the numbers for that line.
      </Typography>

      <TextField
        size="small"
        label="Filter jobs"
        placeholder="Name, words, part number, or size"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        sx={{ mb: 1.5, maxWidth: 420 }}
      />

      <Typography variant="body2" sx={{ mb: 1 }}>
        {page?.order === 'recent'
          ? `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}, newest worksheet date first`
          : page?.jobCount
            ? `${jobs.length} of ${page.jobCount} jobs`
            : 'Jobs with a stored vector'}
      </Typography>

      {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}

      {page?.jobs?.length ? (
        <Box
          sx={{
            mb: 2,
            maxHeight: 360,
            overflow: 'auto',
            border: '1px solid',
            borderColor: outline,
            borderRadius: 2,
          }}
        >
          {jobs.map((job) => (
            <Button
              key={job.jobId}
              fullWidth
              onClick={() => {
                setMemoryId('');
                setJobId(job.jobId);
              }}
              sx={{
                textTransform: 'none',
                justifyContent: 'space-between',
                borderRadius: 0,
                px: 1.5,
                bgcolor: job.jobId === example?.jobId ? 'action.selected' : 'transparent',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: job.jobId === example?.jobId ? 600 : 400 }}>
                {job.jobTitle}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {job.noteDate || (job.lineCount === 1 ? '1 line' : `${job.lineCount} lines`)}
              </Typography>
            </Button>
          ))}
          {jobs.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
              {termSearch ? 'No stored line has those words.' : 'No job name matches that filter.'}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {example ? (
        <Paper sx={{ p: 2.5, mb: 2, borderRadius: 2 }}>
          <Typography variant="overline" color="text.secondary">
            {example.kindLabel}
            {example.customerName && example.customerName !== example.jobTitle ? ` · ${example.customerName}` : ''}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 600, mt: 0.5 }}>
            {example.jobTitle}
          </Typography>
          <Box
            component="p"
            sx={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '1.05rem',
              lineHeight: 1.5,
              my: 1.5,
              px: 1.5,
              py: 1.25,
              borderRadius: '12px',
              border: '1px solid',
              borderColor: outline,
              overflowX: 'auto',
            }}
          >
            {example.previewText}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {example.dimensions} numbers for this one line. The first eight are the start of the list.
          </Typography>
          <Typography variant="body1" sx={{ mt: 1.5 }}>
            {example.text}
          </Typography>
        </Paper>
      ) : null}

      {(page?.detail || []).map((paragraph) => (
        <Typography key={paragraph.slice(0, 48)} variant="body1" sx={{ mb: 1.5 }}>
          {paragraph}
        </Typography>
      ))}

      {example && page?.neighbors?.length ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
            Closest other jobs
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {page.neighbors.map((line) => (
              <Paper key={line.memoryId} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle2">{line.jobTitle}</Typography>
                  <Typography variant="subtitle2" color="text.secondary">
                    {line.score == null ? '' : `${line.score.toFixed(2)} · ${scoreLabel(line.score)}`}
                  </Typography>
                </Box>
                <Typography variant="body2">{line.excerpt}</Typography>
                <Button
                  size="small"
                  sx={{ textTransform: 'none', mt: 0.5, px: 0 }}
                  onClick={() => setMemoryId(line.memoryId)}
                >
                  Show this line’s vector
                </Button>
              </Paper>
            ))}
          </Box>
        </Box>
      ) : null}

      {example && page?.sameJob?.length ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
            Other lines on this job
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {page.sameJob.map((line) => (
              <Button
                key={line.memoryId}
                variant="text"
                onClick={() => setMemoryId(line.memoryId)}
                sx={{ textTransform: 'none', justifyContent: 'flex-start', textAlign: 'left', px: 0 }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {line.kindLabel}
                    {line.score == null ? '' : ` · ${line.score.toFixed(2)}`}
                  </Typography>
                  <Typography variant="body2">{line.excerpt}</Typography>
                </Box>
              </Button>
            ))}
          </Box>
        </Box>
      ) : null}

      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Ask about this vector
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          Ask why a job is close, what one number is, or why “instead of” does not push a line away.
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
          {messages.map((message, index) => (
            <Box
              key={`${message.role}-${index}`}
              sx={{
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '92%',
                px: 1.5,
                py: 1,
                borderRadius: 2,
                bgcolor: message.role === 'user' ? 'primary.main' : 'action.hover',
                color: message.role === 'user' ? 'primary.contrastText' : 'text.primary',
              }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {message.content}
              </Typography>
            </Box>
          ))}
          {asking ? <CircularProgress size={22} /> : null}
        </Box>
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question, false);
          }}
          sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}
        >
          {voiceSupported ? (
            <Button
              type="button"
              variant={listening ? 'contained' : 'outlined'}
              color={listening ? 'error' : 'primary'}
              startIcon={<MicIcon />}
              onClick={startTalk}
              aria-label={listening ? 'End vector talk' : 'Talk about this vector'}
              sx={{ textTransform: 'none' }}
            >
              {listening ? 'End' : 'Talk'}
            </Button>
          ) : null}
          <TextField
            size="small"
            fullWidth
            label="Ask about this vector"
            placeholder="Why is the closest job similar?"
            value={question}
            disabled={!example || asking}
            onChange={(event) => setQuestion(event.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!example || asking || !question.trim()}
            aria-label="Send vector question"
            sx={{ minWidth: 48, px: 1 }}
          >
            <SendIcon fontSize="small" />
          </Button>
        </Box>
        {listening ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Listening. Ask about this vector, then pause.
          </Typography>
        ) : null}
      </Paper>
    </Box>
  );
}
