import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelSpeech,
  collectTranscript,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  usesServerSpeechCapture,
  prefetchLiminalitySpeech,
  speakText,
} from '../voice/browserSpeech';
import { primeChromiumMicrophone, stopPrimedMicrophone } from '../voice/chromiumSpeech';
import { playListeningCue, unlockListeningCue } from '../voice/listeningCue';
import { askLiminalityAssistant, askMapJobs, spokenAssistantReply } from '../voice/assistantVoice';
import { closeJobOverlay, openJobOverlay } from '../voice/jobOverlayBus';
import { abortMapTour, applyMapShow, narrateMapTour, resetMapToPipeline } from '../voice/mapCommandBus';
import {
  COMMAND_ENDPOINT_MS,
  COMMAND_TIMEOUT_MS,
  hasWakeWord,
  isCancelCommand,
  isCloseWorkCommand,
  isJunkTranscript,
  liminalityCommandRoute,
  matchLiminalityCommand,
  parseMapJobSpeech,
  parseSendSpeech,
  registerForWake,
  sendUtteranceFor,
  spokenCommandResponse,
  stripWakeWord,
  type LiminalityRegister,
  type PendingSend,
} from '../voice/liminalityCommands';
import {
  createVoiceAppointment,
  createVoiceTask,
  lookupVoicePhone,
  parseAppointmentSpeech,
  parsePhoneSpeech,
  parseReminderSpeech,
  parseWhenSpeech,
  parseYesNo,
  reminderMessage,
  scheduleVoiceReminder,
  type ShopDraft,
} from '../voice/shopVoice';

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
  const [remainingMs, setRemainingMs] = useState(0);

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
  const pendingShopRef = useRef<ShopDraft | null>(null);
  const lastHandledRef = useRef('');
  const lastHandledAtRef = useRef(0);
  const networkFailsRef = useRef(0);
  const onNavigateRef = useRef(onNavigate);
  const handleWakeRef = useRef<(text: string) => void>(() => {});
  const handleCommandRef = useRef<(text: string) => void>(() => {});
  const assistantHistoryRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const workGenRef = useRef(0);
  const interruptibleRef = useRef(false);
  const closedUntilRef = useRef(0);
  const dismissWorkRef = useRef(() => {});
  const listenForCommandsRef = useRef(() => {});
  const cancelSessionRef = useRef(() => {});

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

  const deadlineLeft = () => Math.max(0, deadlineRef.current - Date.now());

  const commitHeard = useCallback((raw: string) => {
    const spoken = String(raw || '').trim();
    if (!spoken || !enabledRef.current || speakingRef.current) return;
    if (Date.now() < closedUntilRef.current) return;
    if (modeRef.current === 'command' && deadlineLeft() <= 0) return;
    if (isJunkTranscript(spoken) && !hasWakeWord(spoken)) return;
    const key = spoken.toLowerCase();
    if (lastHandledRef.current === key && Date.now() - lastHandledAtRef.current < 1600) return;
    lastHandledRef.current = key;
    lastHandledAtRef.current = Date.now();
    if (endpointRef.current) {
      window.clearTimeout(endpointRef.current);
      endpointRef.current = null;
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
    if (!enabledRef.current || speakingRef.current) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        /* already running */
      }
      return;
    }

    const recognition = createSpeechRecognition() as ReturnType<typeof createSpeechRecognition> & {
      onhearing?: (() => void) | null;
      ontranscribing?: (() => void) | null;
      onidle?: (() => void) | null;
    };
    if (!recognition) return;
    recognitionRef.current = recognition;

    recognition.onhearing = () => {
      if (speakingRef.current || !enabledRef.current) return;
      if (modeRef.current === 'command') {
        setPhase('listening');
        setStatusLabel('Listening');
        return;
      }
      if (modeRef.current === 'wake') setStatusLabel('Listening');
    };
    recognition.ontranscribing = () => {
      if (speakingRef.current || !enabledRef.current) return;
      if (modeRef.current === 'command') {
        setPhase('listening');
        setStatusLabel('Listening');
        return;
      }
      if (modeRef.current === 'wake') {
        setPhase('waiting');
        setStatusLabel('Listening');
      }
    };
    recognition.onidle = () => {
      if (!enabledRef.current || speakingRef.current) return;
      if (modeRef.current === 'command') {
        const left = deadlineLeft();
        setPhase('listening');
        setRemainingMs(left);
        setStatusLabel(`Listening · ${Math.ceil(left / 1000)}s`);
        return;
      }
      if (modeRef.current === 'wake') {
        setPhase('waiting');
        setStatusLabel('Waiting');
      }
    };

    recognition.onresult = (event) => {
      if (speakingRef.current || !enabledRef.current) return;
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
        if (usesServerSpeechCapture()) {
          setStatusLabel('Mic is on, but speech did not reach the server');
          return;
        }
        if (networkFailsRef.current >= 3) {
          setStatusLabel('Speech service busy — toggle the mic');
        }
      }
    };

    recognition.onend = () => {
      if (!enabledRef.current || speakingRef.current || modeRef.current === 'off') return;
      const delay = networkFailsRef.current > 0 ? Math.min(2000 * networkFailsRef.current, 6000) : 80;
      window.setTimeout(() => {
        if (!enabledRef.current || speakingRef.current || modeRef.current === 'off') return;
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
    workGenRef.current += 1;
    closedUntilRef.current = Date.now() + 1400;
    clearTimers();
    deadlineRef.current = 0;
    pendingSendRef.current = {};
    pendingShopRef.current = null;
    interruptibleRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    if (!enabledRef.current) {
      modeRef.current = 'off';
      setHeard('');
      setRemainingMs(0);
      setPhase('off');
      setStatusLabel('Microphone off');
      return;
    }
    modeRef.current = 'wake';
    lastHandledRef.current = '';
    setHeard('');
    setRemainingMs(0);
    setPhase('waiting');
    setStatusLabel('Waiting');
    startRecognition();
    if (opts?.chime) void playListeningCue('close');
  }, [clearTimers, startRecognition]);

  const listenForCommands = useCallback(() => {
    clearTimers();
    if (!enabledRef.current) {
      goWaiting();
      return;
    }
    const left = deadlineLeft();
    if (left <= 0) {
      goWaiting({ chime: true });
      return;
    }
    interruptibleRef.current = false;
    modeRef.current = 'command';
    lastHandledRef.current = '';
    setPhase('listening');
    setRemainingMs(left);
    setStatusLabel(`Listening · ${Math.ceil(left / 1000)}s`);
    startRecognition();
    timeoutRef.current = window.setTimeout(() => {
      goWaiting({ chime: true });
    }, left);
    tickRef.current = window.setInterval(() => {
      const ms = deadlineLeft();
      setRemainingMs(ms);
      if (ms <= 0) return;
      setStatusLabel(`Listening · ${Math.ceil(ms / 1000)}s`);
    }, 200);
  }, [clearTimers, goWaiting, startRecognition]);

  const dismissWork = useCallback(() => {
    workGenRef.current += 1;
    interruptibleRef.current = false;
    pendingSendRef.current = {};
    pendingShopRef.current = null;
    cancelSpeech();
    abortMapTour();
    closeJobOverlay();
  }, []);

  dismissWorkRef.current = dismissWork;
  listenForCommandsRef.current = listenForCommands;

  const cancelSession = useCallback(() => {
    dismissWork();
    goWaiting({ chime: true });
  }, [dismissWork, goWaiting]);
  cancelSessionRef.current = cancelSession;

  const speakAndWait = useCallback(async (text: string) => {
    interruptibleRef.current = true;
    speakingRef.current = true;
    setPhase('speaking');
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
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

        if (endpointRef.current) {
          window.clearTimeout(endpointRef.current);
          endpointRef.current = null;
        }
        modeRef.current = 'off';
        setHeard(spoken);
        setPhase('processing');
        setRemainingMs(deadlineLeft());
        setStatusLabel('Working on it');
        const workGen = workGenRef.current;
        if (hasWakeWord(spoken) && !stripWakeWord(spoken)) {
          listenForCommands();
          return;
        }

        if (isJunkTranscript(stripped) && !matchLiminalityCommand(stripped)) {
          if (workGenRef.current !== workGen) return;
          listenForCommands();
          return;
        }

        if (isCancelCommand(stripped) || isCancelCommand(spoken)) {
          dismissWork();
          goWaiting({ chime: true });
          return;
        }

        const speakShop = async (text: string) => {
          await speakAndWait(text);
          if (workGenRef.current !== workGen) return false;
          listenForCommands();
          return true;
        };

        const scheduleDraftReminder = async (draft: ShopDraft, sendAt: Date) => {
          if (!draft.phone) return speakShop('What number?');
          const booked = await scheduleVoiceReminder({
            to: draft.phone,
            message: reminderMessage(draft),
            sendAt: sendAt.toISOString(),
          });
          pendingShopRef.current = null;
          if (!booked.ok) return speakShop(booked.error || 'Could not schedule that text.');
          return speakShop(
            `I will text a reminder to ${booked.name} on ${booked.dayLabel} at ${booked.timeLabel}.`,
          );
        };

        const offerReminder = async (draft: ShopDraft, preface: string) => {
          pendingShopRef.current = { ...draft, step: 'ask_text' };
          return speakShop(`${preface} Would you like me to text you a reminder?`);
        };

        const continueShop = async (draft: ShopDraft, text: string) => {
          if (draft.step === 'ask_who') {
            const spokenAppt = parseAppointmentSpeech(`schedule an appointment ${text}`) || {
              title: text,
            };
            const title = spokenAppt.title || text;
            if (!title) return speakShop('Who is the appointment for?');
            const when = spokenAppt.when?.ok ? spokenAppt.when : parseWhenSpeech(text);
            if (!when || !when.ok) {
              pendingShopRef.current = { ...draft, title, step: 'ask_when' };
              return speakShop(when && 'reason' in when && when.reason === 'past'
                ? 'That time already passed. When should I book it?'
                : 'When should I book it?');
            }
            const created = await createVoiceAppointment({
              title,
              date: when.at.toISOString(),
              time: when.at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            });
            if (!created.ok) return speakShop(created.error || 'Could not create that appointment.');
            return offerReminder(
              {
                kind: 'appointment',
                step: 'ask_text',
                title: created.title || title,
                timeLabel: created.timeLabel,
              },
              `Okay I booked ${created.title} on ${created.dayLabel} at ${created.timeLabel}.`,
            );
          }

          if (draft.step === 'ask_when') {
            const when = parseWhenSpeech(text);
            if (!when.ok) {
              return speakShop(
                when.reason === 'past'
                  ? 'That time already passed. Give me a future time.'
                  : 'Say something like tomorrow at 2.',
              );
            }
            const created = await createVoiceAppointment({
              title: draft.title,
              date: when.at.toISOString(),
              time: when.at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            });
            if (!created.ok) return speakShop(created.error || 'Could not create that appointment.');
            return offerReminder(
              {
                kind: 'appointment',
                step: 'ask_text',
                title: created.title || draft.title,
                timeLabel: created.timeLabel,
              },
              `Okay I booked ${created.title} on ${created.dayLabel} at ${created.timeLabel}.`,
            );
          }

          if (draft.step === 'ask_text') {
            const phone = parsePhoneSpeech(text);
            const answer = parseYesNo(text);
            if (answer === 'no') {
              pendingShopRef.current = null;
              return speakShop('Okay.');
            }
            if (phone || answer === 'yes') {
              pendingShopRef.current = { ...draft, step: 'ask_number' };
              if (phone) {
                return continueShop(pendingShopRef.current, text);
              }
              return speakShop('What number?');
            }
            return speakShop('Would you like me to text you a reminder?');
          }

          if (draft.step === 'ask_number') {
            const phone = parsePhoneSpeech(text);
            if (!phone) return speakShop('What number?');
            const found = await lookupVoicePhone(phone);
            if (!found.found) {
              return speakShop(
                found.reason === 'no_mobile'
                  ? 'Your number is not on file.'
                  : 'That number is not on file.',
              );
            }
            const next: ShopDraft = {
              ...draft,
              phone: found.mobile,
              personName: found.name,
              step: 'ask_remind_when',
            };
            pendingShopRef.current = next;
            if (draft.when) {
              return scheduleDraftReminder(next, new Date(draft.when));
            }
            return speakShop('Okay when do you want me to send you a reminder text?');
          }

          if (draft.step === 'ask_remind_when') {
            const when = parseWhenSpeech(text);
            if (!when.ok) {
              return speakShop(
                when.reason === 'past'
                  ? 'That time already passed. Give me a future time.'
                  : 'Say something like tonight at 9.',
              );
            }
            return scheduleDraftReminder(draft, when.at);
          }

          return false;
        };

        if (pendingShopRef.current) {
          setStatusLabel('Working');
          await continueShop(pendingShopRef.current, stripped);
          return;
        }

        const reminder = parseReminderSpeech(stripped);
        if (reminder) {
          setStatusLabel('Creating a task');
          if (reminder.when && !reminder.when.ok && reminder.when.reason === 'past') {
            await speakShop('That time already passed. What should I remind you to do?');
            return;
          }
          const created = await createVoiceTask(reminder.title);
          if (!created.ok) {
            await speakShop(created.error || 'Could not create that task.');
            return;
          }
          await offerReminder(
            {
              kind: 'task',
              step: 'ask_text',
              title: created.title || reminder.title,
              when: reminder.when?.ok ? reminder.when.at.toISOString() : undefined,
            },
            'Okay I created a task to do that.',
          );
          return;
        }

        const appointment = parseAppointmentSpeech(stripped);
        if (appointment) {
          setStatusLabel('Creating an appointment');
          if (!appointment.title) {
            pendingShopRef.current = { kind: 'appointment', step: 'ask_who', title: '' };
            await speakShop('Who is the appointment for?');
            return;
          }
          if (!appointment.when?.ok) {
            pendingShopRef.current = {
              kind: 'appointment',
              step: 'ask_when',
              title: appointment.title,
            };
            await speakShop(
              appointment.when?.reason === 'past'
                ? 'That time already passed. When should I book it?'
                : 'When should I book it?',
            );
            return;
          }
          const created = await createVoiceAppointment({
            title: appointment.title,
            date: appointment.when.at.toISOString(),
            time: appointment.when.at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          });
          if (!created.ok) {
            await speakShop(created.error || 'Could not create that appointment.');
            return;
          }
          await offerReminder(
            {
              kind: 'appointment',
              step: 'ask_text',
              title: created.title || appointment.title,
              timeLabel: created.timeLabel,
            },
            `Okay I booked ${created.title} on ${created.dayLabel} at ${created.timeLabel}.`,
          );
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

        const mapIntent = parseMapJobSpeech(stripped);
        if (mapIntent) {
          setStatusLabel('Opening the map');
          const result = await askMapJobs(mapIntent);
          assistantHistoryRef.current = [
            ...assistantHistoryRef.current,
            { role: 'user', content: stripped },
            { role: 'assistant', content: result.reply },
          ].slice(-8);
          const mapJobs = result.mapShow?.jobs?.length || result.mapShow?.jobIds?.length || 0;
          if (result.mapShow && mapJobs > 0) {
            setPhase('executing');
            applyMapShow(result.mapShow);
            if (result.path) {
              onNavigateRef.current(result.path);
              await new Promise((resolve) => window.setTimeout(resolve, 450));
              applyMapShow(result.mapShow);
            }
            if (workGenRef.current !== workGen) return;
            interruptibleRef.current = true;
            await new Promise((resolve) => window.setTimeout(resolve, 400));
            if (workGenRef.current !== workGen) return;
            await narrateMapTour(result.mapShow, speakAndWait);
          } else {
            resetMapToPipeline();
            await speakAndWait(result.reply || 'No jobs in that area.');
          }
          if (workGenRef.current !== workGen) return;
          listenForCommands();
          return;
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
          const mapJobs = result.mapShow?.jobs?.length || result.mapShow?.jobIds?.length || 0;
          if (result.mapShow && mapJobs > 0) {
            setPhase('executing');
            setStatusLabel('Opening the map');
            applyMapShow(result.mapShow);
          } else if (result.mapShow) {
            resetMapToPipeline();
          }
          if (result.path) {
            setPhase('executing');
            setStatusLabel(result.mapShow && mapJobs > 0 ? 'Opening the map' : 'Opening page');
            onNavigateRef.current(result.path);
            if (result.mapShow && mapJobs > 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 450));
              applyMapShow(result.mapShow);
            }
          }
          if (send.matched && send.job && send.employee && /sent|texted|messaged/i.test(result.reply || '')) {
            pendingSendRef.current = {};
          }
          if (workGenRef.current !== workGen) return;
          interruptibleRef.current = true;
          if (result.mapShow && mapJobs > 0) {
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
      if (Date.now() < closedUntilRef.current) return;
      const remainder = stripWakeWord(raw);
      void (async () => {
        clearTimers();
        modeRef.current = 'off';
        pendingSendRef.current = {};
        pendingShopRef.current = null;
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
        if (remainder && !isJunkTranscript(remainder)) {
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
      stopPrimedMicrophone();
      setHeard('');
      setPhase('off');
      setStatusLabel('Microphone off');
      return undefined;
    }
    enabledRef.current = true;
    networkFailsRef.current = 0;
    unlockListeningCue();
    prefetchLiminalitySpeech();
    const armMic = () => {
      if (usesServerSpeechCapture()) void primeChromiumMicrophone().catch(() => {});
    };
    armMic();
    window.addEventListener('pointerdown', armMic);
    goWaiting();
    return () => {
      window.removeEventListener('pointerdown', armMic);
      enabledRef.current = false;
      speakingRef.current = false;
      modeRef.current = 'off';
      clearTimers();
      cancelSpeech();
      destroyRecognition();
      stopPrimedMicrophone();
    };
    // Intentionally only bind to enabled/supported so a command session is not torn down mid-speech.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, supported]);

  useEffect(() => {
    if (!enabled || !supported) return undefined;
    const onInterrupt = (event: Event) => {
      if (!enabledRef.current) return;
      if (event instanceof KeyboardEvent) {
        if (event.repeat) return;
        if (event.key === 'Escape') {
          cancelSessionRef.current();
          return;
        }
        if (!interruptibleRef.current) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') {
          return;
        }
      } else if (!interruptibleRef.current) {
        return;
      }
      dismissWorkRef.current();
      setHeard('Closed');
      if (deadlineLeft() <= 0) {
        cancelSessionRef.current();
        return;
      }
      listenForCommandsRef.current();
    };
    window.addEventListener('pointerdown', onInterrupt, true);
    window.addEventListener('keydown', onInterrupt, true);
    return () => {
      window.removeEventListener('pointerdown', onInterrupt, true);
      window.removeEventListener('keydown', onInterrupt, true);
    };
  }, [enabled, supported]);

  return {
    supported,
    phase,
    statusLabel,
    heard,
    remainingMs,
    cancelSession,
  };
}
