import { useEffect, useRef, useState } from 'react';
import { Box, Button, FormControl, MenuItem, Paper, Select, Typography } from '@mui/material';
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

const ENDPOINT_MS = 1400;

type Phase = 'idle' | 'asking' | 'listening' | 'reacting' | 'done';

async function speakInterview(text: string, voiceUri: string) {
  await speakNeural(text, voiceUri, 'asmr');
}

async function nextInterviewLine(input: {
  name: string;
  start?: boolean;
  answer?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  const { data } = await api.post('/assistant/interview', input);
  return data as { spoken: string; done?: boolean };
}

function listenOnce(signal: { dead: boolean }): Promise<string> {
  return new Promise((resolve) => {
    const recognition = createSpeechRecognition();
    if (!recognition) {
      resolve('');
      return;
    }
    let last = '';
    let timer = 0;
    let settled = false;
    const finish = () => {
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
      resolve(last.trim());
    };
    recognition.onresult = (event) => {
      if (signal.dead) return;
      const { finalText, interimText } = collectTranscript(event);
      last = finalText || interimText || last;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(finish, ENDPOINT_MS);
    };
    recognition.onerror = () => {
      if (!settled && last) finish();
    };
    recognition.onend = () => {
      if (!settled) finish();
    };
    try {
      recognition.start();
    } catch {
      finish();
    }
    window.setTimeout(() => {
      if (!settled) finish();
    }, 28_000);
  });
}

export default function PrankInterview() {
  const supported = isSpeechRecognitionSupported();
  const { voiceUri, setVoiceUri } = useLiminalitySettings();
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [spoken, setSpoken] = useState('');
  const runRef = useRef(0);
  const deadRef = useRef({ dead: false });
  const voice = ELEVEN_VOICES.find((row) => row.uri === neuralVoiceIdFromUri(voiceUri)) || ELEVEN_VOICES[0];
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    return () => {
      deadRef.current.dead = true;
      runRef.current += 1;
      cancelSpeech();
    };
  }, []);

  const stop = () => {
    deadRef.current.dead = true;
    runRef.current += 1;
    cancelSpeech();
    setPhase('idle');
    setHeard('');
    setSpoken('');
  };

  const start = () => {
    if (!supported) return;
    deadRef.current = { dead: false };
    const run = runRef.current + 1;
    runRef.current = run;
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    unlockNeuralAudio();
    setHeard('');
    setSpoken('');
    setPhase('asking');
    void (async () => {
      try {
        const opening = await nextInterviewLine({ name: voiceRef.current.name, start: true, messages });
        if (runRef.current !== run || deadRef.current.dead) return;
        setSpoken(opening.spoken);
        messages.push({ role: 'assistant', content: opening.spoken });
        await speakInterview(opening.spoken, voiceRef.current.uri);
        if (runRef.current !== run || deadRef.current.dead) return;

        while (runRef.current === run && !deadRef.current.dead) {
          setPhase('listening');
          const answer = await listenOnce(deadRef.current);
          if (runRef.current !== run || deadRef.current.dead) return;
          setHeard(answer || '...');
          const turn = await nextInterviewLine({
            name: voiceRef.current.name,
            answer: answer || 'I did not catch that.',
            messages,
          });
          if (runRef.current !== run || deadRef.current.dead) return;
          if (answer) messages.push({ role: 'user', content: answer });
          messages.push({ role: 'assistant', content: turn.spoken });
          if (messages.length > 16) messages.splice(0, messages.length - 16);
          setSpoken(turn.spoken);
          setPhase('reacting');
          await speakInterview(turn.spoken, voiceRef.current.uri);
          if (turn.done) {
            setPhase('done');
            return;
          }
          setPhase('asking');
        }
      } catch (error) {
        if (runRef.current !== run) return;
        const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
        setSpoken(data?.error || 'Could not keep the interview going.');
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
    <Box sx={{ maxWidth: 640, mx: 'auto' }}>
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
              Talent · live interview
            </Typography>
          </Box>
        </Box>

        <FormControl size="small" sx={{ mb: 2, minWidth: 180 }}>
          <Select
            value={voice.uri}
            onChange={(event) => {
              unlockNeuralAudio();
              setVoiceUri(String(event.target.value));
            }}
          >
            {ELEVEN_VOICES.map((row) => (
              <MenuItem key={row.uri} value={row.uri}>
                {row.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
          {label}
        </Typography>
        <Typography sx={{ mt: 0.5, mb: 2, fontSize: 18, fontWeight: 500, lineHeight: 1.45 }}>
          {phase === 'idle'
            ? 'Sit down, pick a voice, and answer out loud. She will listen and keep the conversation going.'
            : spoken}
        </Typography>

        {heard && phase !== 'idle' ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontStyle: 'italic' }}>
            You: {heard}
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
