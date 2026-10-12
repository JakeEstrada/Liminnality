import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelSpeech,
  collectTranscript,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  prefetchLiminalitySpeech,
  speakText,
} from '../voice/browserSpeech';
import { playListeningCue, unlockListeningCue } from '../voice/listeningCue';
import { askLiminalityAssistant, spokenAssistantReply } from '../voice/assistantVoice';
import { closeJobOverlay, openJobOverlay } from '../voice/jobOverlayBus';
import { abortMapTour, applyMapShow, narrateMapTour } from '../voice/mapCommandBus';
import {
  COMMAND_ENDPOINT_MS,
  COMMAND_TIMEOUT_MS,
  hasWakeWord,
  isCancelCommand,
  isCloseWorkCommand,
  liminalityCommandRoute,
  matchLiminalityCommand,
  parseSendSpeech,
  registerForWake,
  sendUtteranceFor,
  spokenCommandResponse,
  stripWakeWord,
  type LiminalityRegister,
  type PendingSend,
} from '../voice/liminalityCommands';

export type LiminalityPhase =
  | 'off'
  | 'waiting'
  | 'listening'
  | 'processing'
  | 'executing'
  | 'speaking';

export function useLiminalityVoice({
  enabled,
  onNavigate,
}: {
  enabled: boolean;
  onNavigate: (path: string) => void;
}) {
  const supported = isSpeechRecognitionSupported();
  const [phase, setPhase] = useState<LiminalityPhase>('off');
  const [statusLabel, setStatusLabel] = useState('Microphone off');
  const [heard, setHeard] = useState('');

  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const modeRef = useRef<'off' | 'wake' | 'command'>('off');
  const speakingRef = useRef(false);
  const registerRef = useRef<LiminalityRegister>('polite');
  const enabledRef = useRef(enabled);
  const timeoutRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const endpointRef = useRef<number | null>(null);
  const deadlineRef = useRef(0);
  const pendingSendRef = useRef<PendingSend>({});
  const lastHandledRef = useRef('');
  const lastHandledAtRef = useRef(0);
  const networkFailsRef = useRef(0);
  const onNavigateRef = useRef(onNavigate);
  const handleWakeRef = useRef<(text: string) => void>(() => {});
  const handleCommandRef = useRef<(text: string) => void>(() => {});
  const assistantHistoryRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const workGenRef = useRef(0);

  enabledRef.current = enabled;
  onNavigateRef.current = onNavigate;

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (endpointRef.current) window.clearTimeout(endpointRef.current);
    timeoutRef.current = null;
    tickRef.current = null;
    endpointRef.current = null;
  }, []);

  const commitHeard = useCallback((raw: string) => {
    const spoken = String(raw || '').trim();
    if (!spoken || !enabledRef.current) return;
    const closing = isCloseWorkCommand(spoken) || isCancelCommand(stripWakeWord(spoken) || spoken);
    if (speakingRef.current && !closing) return;
    const key = spoken.toLowerCase();
    if (lastHandledRef.current === key && Date.now() - lastHandledAtRef.current < 1600) return;
    lastHandledRef.current = key;
    lastHandledAtRef.current = Date.now();
    if (endpointRef.current) {
      window.clearTimeout(endpointRef.current);
      endpointRef.current = null;
    }
    if (closing) {
      handleCommandRef.current(spoken);
      return;
    }
    if (modeRef.current === 'wake') handleWakeRef.current(spoken);
    else if (modeRef.current === 'command') handleCommandRef.current(spoken);
  }, []);

  const destroyRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null;
  }, []);

  const startRecognition = useCallback(() => {
    if (!enabledRef.current) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        /* already running */
      }
      return;
    }

    const recognition = createSpeechRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (!enabledRef.current) return;
      networkFailsRef.current = 0;
      const { finalText, interimText } = collectTranscript(event);
      const live = finalText || interimText;
      if (live) setHeard(live);
      if (finalText) {
        commitHeard(finalText);
        return;
      }
      if (!interimText) return;
      if (endpointRef.current) window.clearTimeout(endpointRef.current);
      const mode = modeRef.current;
      const remainder = mode === 'wake' ? stripWakeWord(interimText) : '';
      const canCommit =
        mode === 'command' ||
        (mode === 'wake' && hasWakeWord(interimText) && (!remainder || matchLiminalityCommand(remainder)));
      if (!canCommit) return;
      const delay = mode === 'command' ? COMMAND_ENDPOINT_MS : remainder ? 640 : 780;
      endpointRef.current = window.setTimeout(() => {
        commitHeard(interimText);
      }, delay);
    };

    recognition.onerror = (event) => {
      const error = String(event?.error || '');
      if (error === 'aborted' || error === 'no-speech') return;
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        enabledRef.current = false;
        modeRef.current = 'off';
        destroyRecognition();
        setPhase('off');
        setStatusLabel('Microphone blocked');
        return;
      }
      if (error === 'network') {
        networkFailsRef.current += 1;
        if (networkFailsRef.current >= 3) {
          setStatusLabel('Speech service busy — toggle the mic');
        }
      }
    };

    recognition.onend = () => {
      if (!enabledRef.current) return;
      const delay = networkFailsRef.current > 0 ? Math.min(2000 * networkFailsRef.current, 6000) : 80;
      window.setTimeout(() => {
        if (!enabledRef.current) return;
        try {
          recognition.start();
        } catch {
          /* ignore */
        }
      }, delay);
    };

    try {
      recognition.start();
    } catch {
      /* ignore */
    }
  }, [commitHeard, destroyRecognition]);

  const goWaiting = useCallback((opts?: { chime?: boolean }) => {
    clearTimers();
    deadlineRef.current = 0;
    pendingSendRef.current = {};
    if (!enabledRef.current) {
      modeRef.current = 'off';
      setHeard('');
      setPhase('off');
      setStatusLabel('Microphone off');
      return;
    }
    modeRef.current = 'wake';
    lastHandledRef.current = '';
    setHeard('');
    setPhase('waiting');
    setStatusLabel('Waiting');
    startRecognition();
    if (opts?.chime) void playListeningCue('close');
  }, [clearTimers, startRecognition]);

  const remainingMs = () => Math.max(0, deadlineRef.current - Date.now());

  const listenForCommands = useCallback(() => {
    clearTimers();
    if (!enabledRef.current) {
      goWaiting();
      return;
    }
    const left = remainingMs();
    if (left <= 0) {
      goWaiting({ chime: true });
      return;
    }
    modeRef.current = 'command';
    lastHandledRef.current = '';
    setPhase('listening');
    setStatusLabel(`Listening · ${Math.ceil(left / 1000)}s`);
    startRecognition();
    timeoutRef.current = window.setTimeout(() => {
      goWaiting({ chime: true });
    }, left);
    tickRef.current = window.setInterval(() => {
      const ms = remainingMs();
      if (ms <= 0) return;
      setStatusLabel(`Listening · ${Math.ceil(ms / 1000)}s`);
    }, 1000);
  }, [clearTimers, goWaiting, startRecognition]);

  const dismissWork = useCallback(() => {
    workGenRef.current += 1;
    pendingSendRef.current = {};
    cancelSpeech();
    abortMapTour();
    closeJobOverlay();
  }, []);

  const speakAndWait = useCallback(async (text: string) => {
    speakingRef.current = true;
    setPhase('speaking');
    try {
      await speakText(text, { tone: registerRef.current });
    } finally {
      speakingRef.current = false;
    }
  }, []);

  useEffect(() => {
    handleCommandRef.current = (raw: string) => {
      const spoken = String(raw || '').trim();
      if (!spoken || !enabledRef.current) return;
      void (async () => {
        const stripped = stripWakeWord(spoken) || spoken;
        if (isCloseWorkCommand(stripped) || isCloseWorkCommand(spoken)) {
          dismissWork();
          setHeard('Closed');
          listenForCommands();
          return;
        }

        clearTimers();
        modeRef.current = 'off';
        setHeard(spoken);
        setPhase('processing');
        setStatusLabel('Processing');
        const workGen = workGenRef.current;
        if (hasWakeWord(spoken) && !stripWakeWord(spoken)) {
          listenForCommands();
          return;
        }

        if (isCancelCommand(stripped) || isCancelCommand(spoken)) {
          dismissWork();
          goWaiting({ chime: true });
          return;
        }

        const send = parseSendSpeech(stripped, pendingSendRef.current);
        if (send.matched) {
          pendingSendRef.current = { job: send.job, employee: send.employee };
          if (!send.job && send.employee) {
            await speakAndWait('Which job?');
            if (workGenRef.current !== workGen) return;
            listenForCommands();
            return;
          }
          if (send.job && !send.employee) {
            await speakAndWait('Who should I send it to?');
            if (workGenRef.current !== workGen) return;
            listenForCommands();
            return;
          }
        }

        const command = matchLiminalityCommand(stripped);
        if (command) {
          setPhase('executing');
          setStatusLabel(`Opening ${command.label}`);
          onNavigateRef.current(liminalityCommandRoute(command, spoken));
          await speakAndWait(spokenCommandResponse(command, registerRef.current));
          if (workGenRef.current !== workGen) return;
          listenForCommands();
          return;
        }

        const assistantSpoken = send.matched && send.job && send.employee
          ? sendUtteranceFor(pendingSendRef.current)
          : stripped;
        setStatusLabel('Looking it up');
        try {
          const result = await askLiminalityAssistant(assistantHistoryRef.current, assistantSpoken);
          assistantHistoryRef.current = [
            ...assistantHistoryRef.current,
            { role: 'user', content: assistantSpoken },
            { role: 'assistant', content: result.reply },
          ].slice(-8);
          if (result.openJob) {
            setPhase('executing');
            setStatusLabel('Opening job');
            openJobOverlay(result.openJob);
          }
          if (result.mapShow) {
            setPhase('executing');
            setStatusLabel('Opening the map');
            applyMapShow(result.mapShow);
          }
          if (result.path) {
            setPhase('executing');
            setStatusLabel(result.mapShow ? 'Opening the map' : 'Opening page');
            onNavigateRef.current(result.path);
            if (result.mapShow) {
              await new Promise((resolve) => window.setTimeout(resolve, 450));
              applyMapShow(result.mapShow);
            }
          }
          if (send.matched && send.job && send.employee && /sent|texted|messaged/i.test(result.reply || '')) {
            pendingSendRef.current = {};
          }
          if (workGenRef.current !== workGen) return;
          if (result.mapShow && (result.mapShow.jobs.length || result.mapShow.jobIds.length)) {
            await new Promise((resolve) => window.setTimeout(resolve, 400));
            if (workGenRef.current !== workGen) return;
            await narrateMapTour(result.mapShow, speakAndWait);
          } else if (result.reply) {
            await speakAndWait(result.reply);
          } else {
            await speakAndWait("Didn't catch that. Say it again.");
          }
        } catch (error) {
          if (workGenRef.current !== workGen) return;
          const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
          const message = spokenAssistantReply(data?.error || '') || "Didn't catch that. Say it again.";
          await speakAndWait(message);
        }
        if (workGenRef.current !== workGen) return;
        listenForCommands();
      })();
    };

    handleWakeRef.current = (raw: string) => {
      if (!hasWakeWord(raw) || !enabledRef.current) return;
      const remainder = stripWakeWord(raw);
      void (async () => {
        clearTimers();
        modeRef.current = 'off';
        pendingSendRef.current = {};
        setHeard(raw);
        setPhase('listening');
        setStatusLabel('Listening');
        registerRef.current = registerForWake(raw);
        deadlineRef.current = Date.now() + COMMAND_TIMEOUT_MS;
        speakingRef.current = true;
        try {
          recognitionRef.current?.stop();
        } catch {
          /* ignore */
        }
        try {
          await playListeningCue('start');
        } finally {
          speakingRef.current = false;
        }
        if (!enabledRef.current) {
          goWaiting();
          return;
        }
        if (remainder) {
          handleCommandRef.current(remainder);
          return;
        }
        setHeard('Listening for a command');
        listenForCommands();
      })();
    };
  }, [clearTimers, dismissWork, goWaiting, listenForCommands, speakAndWait]);

  useEffect(() => {
    if (!supported) {
      setPhase('off');
      setStatusLabel('Voice not available in this browser');
      return undefined;
    }
    if (!enabled) {
      enabledRef.current = false;
      speakingRef.current = false;
      registerRef.current = 'polite';
      modeRef.current = 'off';
      networkFailsRef.current = 0;
      assistantHistoryRef.current = [];
      clearTimers();
      cancelSpeech();
      destroyRecognition();
      setHeard('');
      setPhase('off');
      setStatusLabel('Microphone off');
      return undefined;
    }
    enabledRef.current = true;
    networkFailsRef.current = 0;
    unlockListeningCue();
    prefetchLiminalitySpeech();
    goWaiting();
    return () => {
      enabledRef.current = false;
      speakingRef.current = false;
      modeRef.current = 'off';
      clearTimers();
      cancelSpeech();
      destroyRecognition();
    };
    // Intentionally only bind to enabled/supported so a command session is not torn down mid-speech.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, supported]);

  return {
    supported,
    phase,
    statusLabel,
    heard,
  };
}
