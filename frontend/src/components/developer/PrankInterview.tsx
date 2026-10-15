import { useEffect, useRef, useState } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import api from '../../utils/axios';
import { useLiminalitySettings } from '../../context/LiminalitySettingsContext';
import {
  cancelSpeech,
  collectTranscript,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
} from '../../voice/browserSpeech';
import { speakNeural, unlockNeuralAudio } from '../../voice/neuralSpeech';
import { ELEVEN_VOICES, neuralVoiceIdFromUri } from '../../voice/neuralVoices';

const ENDPOINT_MS = 1800;
const SETTLE_MS = 700;

type Phase = 'idle' | 'asking' | 'listening' | 'reacting' | 'done';

function normalizeHeard(raw: string) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEcho(heard: string, spoken: string) {
  const a = normalizeHeard(heard);
  const b = normalizeHeard(spoken);
  if (!a || !b) return !a;
  if (a === b) return true;
  const ratio = a.length / b.length;
  if (b.includes(a) && a.length >= 18 && ratio < 0.9) return true;
  return false;
}

async function speakInterview(text: string, voiceUri: string) {
  await speakNeural(text, voiceUri, 'asmr');
  await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS));
}

async function nextInterviewLine(input: {
  name: string;
  start?: boolean;
  answer?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  const { data } = await api.post('/assistant/interview', input);
  return data as { spoken: string; done?: boolean; showRobot?: boolean };
}

function mentionsThisRobot(text: string) {
  return /this robot|look at (this |the )?robot/i.test(text || '');
}

function listenOnce(
  signal: { dead: boolean },
  lastSpoken: string,
  onLive: (text: string) => void,
): Promise<string> {
  return new Promise((resolve) => {
    const recognition = createSpeechRecognition();
    if (!recognition) {
      resolve('');
      return;
    }
    let last = '';
    let timer = 0;
    let settled = false;
    const finish = (text = last) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      try {
        recognition.onresult = null;
        recognition.onend = null;
        recognition.onerror = null;
        recognition.stop();
      } catch {
        /* already stopped */
      }
      resolve(text.trim());
    };
    recognition.onresult = (event) => {
      if (signal.dead) return;
      const { finalText, interimText } = collectTranscript(event);
      const text = String(finalText || interimText || '').trim();
      if (!text) return;
      onLive(text);
      if (isEcho(text, lastSpoken)) return;
      last = text;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => finish(last), ENDPOINT_MS);
    };
    recognition.onerror = () => {
      if (settled) return;
      if (last) finish(last);
    };
    recognition.onend = () => {
      if (settled) return;
      if (last) {
        finish(last);
        return;
      }
      if (signal.dead) {
        finish('');
        return;
      }
      window.setTimeout(() => {
        if (settled || signal.dead) return;
        try {
          recognition.start();
        } catch {
          finish('');
        }
      }, 160);
    };
    try {
      recognition.start();
    } catch {
      finish('');
    }
    window.setTimeout(() => {
      if (!settled) finish(last);
    }, 45_000);
  });
}

async function listenForAnswer(
  signal: { dead: boolean },
  lastSpoken: string,
  onLive: (text: string) => void,
) {
  while (!signal.dead) {
    const heard = await listenOnce(signal, lastSpoken, onLive);
    if (heard && !isEcho(heard, lastSpoken)) return heard;
  }
  return '';
}

export default function PrankInterview() {
  const supported = isSpeechRecognitionSupported();
  const { voiceUri, setHoldMic } = useLiminalitySettings();
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [spoken, setSpoken] = useState('');
  const [showRobot, setShowRobot] = useState(false);
  const runRef = useRef(0);
  const deadRef = useRef({ dead: false });
  const voice = ELEVEN_VOICES.find((row) => row.uri === neuralVoiceIdFromUri(voiceUri)) || ELEVEN_VOICES[0];
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    return () => {
      deadRef.current.dead = true;
      runRef.current += 1;
      setHoldMic(false);
      cancelSpeech();
    };
  }, [setHoldMic]);

  const stop = () => {
    deadRef.current.dead = true;
    runRef.current += 1;
    setHoldMic(false);
    cancelSpeech();
    setPhase('idle');
    setHeard('');
    setSpoken('');
    setShowRobot(false);
  };

  const start = () => {
    if (!supported) return;
    deadRef.current = { dead: false };
    const run = runRef.current + 1;
    runRef.current = run;
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    unlockNeuralAudio();
    setHoldMic(true);
    setHeard('');
    setSpoken('');
    setShowRobot(false);
    setPhase('asking');
    void (async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      try {
        const opening = await nextInterviewLine({ name: voiceRef.current.name, start: true, messages });
        if (runRef.current !== run || deadRef.current.dead) return;
        setSpoken(opening.spoken);
        if (opening.showRobot || mentionsThisRobot(opening.spoken)) setShowRobot(true);
        messages.push({ role: 'assistant', content: opening.spoken });
        await speakInterview(opening.spoken, voiceRef.current.uri);
        if (runRef.current !== run || deadRef.current.dead) return;

        while (runRef.current === run && !deadRef.current.dead) {
          setPhase('listening');
          setHeard('');
          const lastSpoken = messages.filter((row) => row.role === 'assistant').at(-1)?.content || '';
          const answer = await listenForAnswer(deadRef.current, lastSpoken, setHeard);
          if (runRef.current !== run || deadRef.current.dead) return;
          if (!answer) continue;
          setHeard(answer);
          const turn = await nextInterviewLine({
            name: voiceRef.current.name,
            answer,
            messages,
          });
          if (runRef.current !== run || deadRef.current.dead) return;
          messages.push({ role: 'user', content: answer });
          messages.push({ role: 'assistant', content: turn.spoken });
          if (messages.length > 16) messages.splice(0, messages.length - 16);
          setSpoken(turn.spoken);
          if (turn.showRobot || mentionsThisRobot(turn.spoken)) setShowRobot(true);
          setPhase('reacting');
          await speakInterview(turn.spoken, voiceRef.current.uri);
          if (turn.done) {
            setHoldMic(false);
            setPhase('done');
            return;
          }
          setPhase('asking');
        }
      } catch (error) {
        if (runRef.current !== run) return;
        const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
        setSpoken(data?.error || 'Could not keep the interview going.');
        setHoldMic(false);
        setPhase('done');
      }
    })();
  };

  const label =
    phase === 'idle'
      ? 'Ready when you are'
      : phase === 'listening'
        ? 'Listening'
        : phase === 'reacting'
          ? 'Responding'
          : phase === 'done'
            ? 'Interview complete'
            : 'Speaking';

  return (
    <Box sx={{ maxWidth: showRobot ? 720 : 640, mx: 'auto' }}>
      <Paper
        sx={{
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mb: 2 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {voice.name.slice(0, 1)}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 600, lineHeight: 1.25 }}>{voice.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              Talent · ERP interview
            </Typography>
          </Box>
        </Box>

        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
          {label}
        </Typography>
        <Typography sx={{ mt: 0.5, mb: showRobot ? 1.5 : 2, fontSize: 18, fontWeight: 500, lineHeight: 1.45 }}>
          {phase === 'idle'
            ? 'Sit down and answer out loud. Change her voice from the Liminality chip.'
            : spoken}
        </Typography>

        {showRobot ? (
          <Box
            component="img"
            src="/interview-robot.png"
            alt="This robot"
            sx={{
              display: 'block',
              width: '100%',
              maxHeight: 420,
              objectFit: 'contain',
              borderRadius: 2,
              bgcolor: '#f4f1ec',
              mb: 2,
            }}
          />
        ) : null}

        {phase === 'listening' || heard ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontStyle: 'italic' }}>
            {heard ? `You: ${heard}` : 'Go ahead. I am listening.'}
          </Typography>
        ) : null}

        {!supported ? (
          <Typography variant="body2" color="error">
            This browser cannot listen. Use Chrome, Edge, or the shop Chromium setup.
          </Typography>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1 }}>
          {phase === 'idle' || phase === 'done' ? (
            <Button variant="contained" onClick={start} disabled={!supported} sx={{ textTransform: 'none' }}>
              {phase === 'done' ? 'Start over' : 'Start interview'}
            </Button>
          ) : (
            <Button color="inherit" variant="outlined" onClick={stop} sx={{ textTransform: 'none' }}>
              End interview
            </Button>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
