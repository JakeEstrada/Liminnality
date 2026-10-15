import { useEffect, useRef, useState } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import {
  cancelSpeech,
  collectTranscript,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
} from '../../voice/browserSpeech';
import { speakNeural, unlockNeuralAudio } from '../../voice/neuralSpeech';

const INTERVIEW_VOICE = 'eleven:natasha';
const ENDPOINT_MS = 1200;

type Turn = {
  ask: string;
  react: string;
};

const TURNS: Turn[] = [
  {
    ask: 'Hi... take a breath. Tell me about yourself.',
    react: 'Uuuuughhh... that is soooo great to hear... nngh... yeah...',
  },
  {
    ask: 'Why do you think you would be a good fit for this position?',
    react: 'Mmmhmm... yeah... I hear you... ugh... yeah... that is so good...',
  },
  {
    ask: 'What is your greatest strength?',
    react: 'Haaah... mmm... okay... I like that... nngh... keep going...',
  },
  {
    ask: 'And your biggest weakness?',
    react: 'Uuuuhhh... wow... yeah... that is... mmm... really honest of you...',
  },
  {
    ask: 'Where do you see yourself in five years?',
    react: 'Mmm... five years... haaah... that sounds so nice... ughh yeah...',
  },
  {
    ask: 'Tell me about a time you handled conflict at work.',
    react: 'Nngh... I can just picture it... mmmhmm... you did so well...',
  },
  {
    ask: 'How do you handle stress when things get busy?',
    react: 'Uuuugh... stress... mmm... I hear you... that is... soo relieving to hear...',
  },
  {
    ask: 'Describe a challenge you overcame recently.',
    react: 'Haaah... mmm yes... that is... nngh... such a good answer...',
  },
  {
    ask: 'Do you work better alone, or on a team?',
    react: 'Mmmhmm... yeah... either way... ugh... I like how you said that...',
  },
  {
    ask: 'What would you bring to this company on day one?',
    react: 'Uuuuuhhh... day one... mmm... that is soooo hot... I mean... helpful... yeah...',
  },
  {
    ask: 'What are your salary expectations?',
    react: 'Nngh... money talk... haaah... okay... I can work with that... mmm...',
  },
  {
    ask: 'Why should we hire you over everyone else?',
    react: 'Mmm... because of you... ughhh... yeah... that is... so convincing...',
  },
  {
    ask: 'If you could change one thing about your last job, what would it be?',
    react: 'Haaah... mmmhmm... I feel that... nngh... thank you for sharing...',
  },
  {
    ask: 'Last one... do you have any questions for me?',
    react: 'Uuuughhh... mmm... that is all I needed... haaah... we will be in touch... yeah...',
  },
];

type Phase = 'idle' | 'asking' | 'listening' | 'reacting' | 'done';

async function speakAsmr(text: string) {
  await speakNeural(text, INTERVIEW_VOICE, 'asmr');
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
      if (!settled && !last) finish();
    }, 18_000);
  });
}

export default function PrankInterview() {
  const supported = isSpeechRecognitionSupported();
  const [phase, setPhase] = useState<Phase>('idle');
  const [index, setIndex] = useState(0);
  const [heard, setHeard] = useState('');
  const [spoken, setSpoken] = useState('');
  const runRef = useRef(0);
  const deadRef = useRef({ dead: false });

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
    setIndex(0);
    setHeard('');
    setSpoken('');
  };

  const start = () => {
    if (!supported) return;
    deadRef.current = { dead: false };
    const run = runRef.current + 1;
    runRef.current = run;
    unlockNeuralAudio();
    setHeard('');
    setIndex(0);
    setPhase('asking');
    void (async () => {
      await speakAsmr('Mmm... hi... I am Lauren, from talent... haaah... whenever you are ready...');
      if (runRef.current !== run || deadRef.current.dead) return;
      for (let i = 0; i < TURNS.length; i += 1) {
        if (runRef.current !== run || deadRef.current.dead) return;
        setIndex(i);
        setHeard('');
        setSpoken(TURNS[i].ask);
        setPhase('asking');
        await speakAsmr(TURNS[i].ask);
        if (runRef.current !== run || deadRef.current.dead) return;
        setPhase('listening');
        const answer = await listenOnce(deadRef.current);
        if (runRef.current !== run || deadRef.current.dead) return;
        setHeard(answer || '...');
        setSpoken(TURNS[i].react);
        setPhase('reacting');
        await speakAsmr(TURNS[i].react);
      }
      if (runRef.current !== run || deadRef.current.dead) return;
      setPhase('done');
      setSpoken('We will let you know.');
    })();
  };

  const turn = TURNS[index];
  const label =
    phase === 'idle'
      ? 'Ready when you are'
      : phase === 'listening'
        ? 'Listening'
        : phase === 'reacting'
          ? 'Reacting'
          : phase === 'done'
            ? 'Interview complete'
            : 'Asking';

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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mb: 2.5 }}>
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
            L
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 600, lineHeight: 1.25 }}>Lauren Hale</Typography>
            <Typography variant="body2" color="text.secondary">
              Talent · live interview
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {phase === 'idle' ? '' : `${index + 1} / ${TURNS.length}`}
          </Typography>
        </Box>

        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
          {label}
        </Typography>
        <Typography sx={{ mt: 0.5, mb: 2, fontSize: 18, fontWeight: 500, lineHeight: 1.45 }}>
          {phase === 'idle'
            ? 'This is a live interview. Sit down, hit start, and answer out loud.'
            : spoken}
        </Typography>

        {heard ? (
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

      {phase !== 'idle' && turn ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, px: 0.5 }}>
          Answer the question, then pause. She will react and move on.
        </Typography>
      ) : null}
    </Box>
  );
}
