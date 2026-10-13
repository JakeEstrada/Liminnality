import api from '../utils/axios';

export type ShopDraft = {
  kind: 'task' | 'appointment';
  step: 'ask_who' | 'ask_when' | 'ask_text' | 'ask_number' | 'ask_remind_when';
  title: string;
  when?: string;
  timeLabel?: string;
  phone?: string;
  personName?: string;
};

export type WhenParse =
  | { ok: true; at: Date; label: string }
  | { ok: false; reason: 'past' | 'unclear' };

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const HOUR_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  noon: 12,
  midnight: 0,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function clean(raw: string) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSpokenWhen(date: Date) {
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

function setClock(base: Date, hour24: number, minute = 0) {
  const next = new Date(base);
  next.setHours(hour24, minute, 0, 0);
  return next;
}

function parseClock(text: string): { hour24: number; minute: number } | null {
  if (/\bmidnight\b/.test(text)) return { hour24: 0, minute: 0 };
  if (/\bnoon\b/.test(text)) return { hour24: 12, minute: 0 };
  const numeric = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\s*m|p\s*m|am|pm)?/);
  if (numeric) {
    let hour = Number(numeric[1]);
    const minute = Number(numeric[2] || 0);
    if (!Number.isFinite(hour) || hour > 24 || minute > 59) return null;
    const mer = (numeric[3] || '').replace(/\s+/g, '');
    if (mer.startsWith('a')) {
      if (hour === 12) hour = 0;
    } else if (mer.startsWith('p') || hour <= 11) {
      if (hour < 12) hour += 12;
    }
    if (hour === 24) hour = 0;
    return { hour24: hour, minute };
  }
  for (const [word, hour] of Object.entries(HOUR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      let hour24 = hour;
      if (/\b(a\s*m|am|morning)\b/.test(text)) {
        if (hour24 === 12) hour24 = 0;
      } else if (hour24 > 0 && hour24 < 12) {
        hour24 += 12;
      }
      return { hour24, minute: 0 };
    }
  }
  return null;
}

export function parseWhenSpeech(raw: string, now = new Date()): WhenParse {
  const text = clean(raw);
  if (!text) return { ok: false, reason: 'unclear' };
  if (/\b(yesterday|last week|already|in the past)\b/.test(text)) {
    return { ok: false, reason: 'past' };
  }

  const clock = parseClock(text) || { hour24: 21, minute: 0 };
  let at = setClock(now, clock.hour24, clock.minute);

  if (/\bin an hour\b/.test(text)) {
    at = new Date(now.getTime() + 60 * 60 * 1000);
  } else if (/\bin (\d+|one|two|three) hours?\b/.test(text)) {
    const count = text.match(/\bin (one|two|three|\d+) hours?\b/);
    const map: Record<string, number> = { one: 1, two: 2, three: 3 };
    const hours = map[count?.[1] || ''] || Number(count?.[1] || 1);
    at = new Date(now.getTime() + Math.max(1, hours) * 60 * 60 * 1000);
  } else if (/\bnext week\b/.test(text)) {
    at = setClock(now, clock.hour24, clock.minute);
    at.setDate(at.getDate() + 7);
  } else if (/\btomorrow\b/.test(text)) {
    at = setClock(now, clock.hour24, clock.minute);
    at.setDate(at.getDate() + 1);
  } else if (/\b(tonight|today|this evening)\b/.test(text)) {
    at = setClock(now, clock.hour24, clock.minute);
  } else {
    const weekday = Object.keys(WEEKDAYS).find((day) => text.includes(day));
    if (weekday) {
      at = setClock(now, clock.hour24, clock.minute);
      let delta = (WEEKDAYS[weekday] + 7 - at.getDay()) % 7;
      if (delta === 0 && at.getTime() <= now.getTime()) delta = 7;
      at.setDate(at.getDate() + delta);
    } else if (!parseClock(text) && !/\b(at|on)\b/.test(text)) {
      return { ok: false, reason: 'unclear' };
    }
  }

  if (at.getTime() <= now.getTime()) return { ok: false, reason: 'past' };
  return { ok: true, at, label: formatSpokenWhen(at) };
}

export function parseYesNo(raw: string): 'yes' | 'no' | null {
  const text = clean(raw);
  if (/^(yes|yeah|yep|yup|sure|ok|okay|please|do it|yes please|yeah please)\b/.test(text)) return 'yes';
  if (/^(no|nope|nah|no thanks|no thank you|don t|do not|dont)\b/.test(text)) return 'no';
  return null;
}

export function parsePhoneSpeech(raw: string): { me?: boolean; digits?: string } | null {
  const text = clean(raw);
  if (!text) return null;
  if (/^(me|my number|text me|use mine|my phone)$/.test(text)) return { me: true };
  const fromWords = text
    .split(' ')
    .map((word) => (/^\d$/.test(word) ? word : DIGIT_WORDS[word] || ''))
    .join('');
  const digits = (fromWords || text.replace(/\D/g, '')).replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length === 10) return { digits: ten };
  return null;
}

function stripWhenTail(text: string) {
  return text
    .replace(
      /\s+(tonight|today|tomorrow|yesterday|next week|this evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at\s+\d.*|in an hour|in \d+ hours?)\b.*$/i,
      '',
    )
    .replace(/\s+(on|at|for)$/i, '')
    .trim();
}

export function parseReminderSpeech(raw: string): { title: string; when?: WhenParse } | null {
  const text = clean(raw);
  const match = text.match(
    /^(?:can you |could you |please )?(?:remind me(?: to)?|set a reminder(?: to| for)?|add a(?:n)? task(?: to| for)?|create a task(?: to| for)?)\s+(.+)$/,
  );
  if (!match) return null;
  const rest = match[1].replace(/^(to do|do)\s+/, '').trim();
  if (!rest) return null;
  const when = parseWhenSpeech(rest);
  const title = stripWhenTail(rest) || rest;
  return { title, when: when.ok || when.reason === 'past' ? when : undefined };
}

export function parseAppointmentSpeech(raw: string): { title: string; when?: WhenParse } | null {
  const text = clean(raw);
  const match = text.match(
    /^(?:can you |could you |please )?(?:create|make|book|set|add|schedule)(?: me)?(?: an| a)? (?:appointment|meeting|visit)(?: with| for| about)?\s*(.*)$/,
  );
  if (!match) return null;
  const rest = String(match[1] || '').trim();
  if (!rest) return { title: '' };
  const when = parseWhenSpeech(rest);
  const title = stripWhenTail(rest);
  return { title, when: when.ok || when.reason === 'past' ? when : undefined };
}

export async function createVoiceTask(title: string) {
  const { data } = await api.post('/assistant/shop', { action: 'create_task', title });
  return data as { ok?: boolean; title?: string; error?: string };
}

export async function lookupVoicePhone(input: { phone?: string; me?: boolean }) {
  const { data } = await api.post('/assistant/shop', {
    action: 'lookup_phone',
    phone: input.phone,
    me: input.me,
  });
  return data as { found?: boolean; name?: string; mobile?: string; reason?: string };
}

export async function scheduleVoiceReminder(input: { to: string; message: string; sendAt: string }) {
  const { data } = await api.post('/assistant/shop', { action: 'schedule_reminder', ...input });
  return data as { ok?: boolean; name?: string; dayLabel?: string; timeLabel?: string; error?: string };
}

export async function createVoiceAppointment(input: { title: string; date: string; time?: string }) {
  const { data } = await api.post('/assistant/shop', {
    action: 'create_appointment',
    title: input.title,
    date: input.date,
    time: input.time,
    customerQuery: input.title,
  });
  return data as {
    ok?: boolean;
    title?: string;
    dayLabel?: string;
    timeLabel?: string;
    error?: string;
  };
}

export function reminderMessage(draft: ShopDraft) {
  if (draft.kind === 'appointment') {
    return `Reminder: ${draft.title}${draft.timeLabel ? ` at ${draft.timeLabel}` : ''}.`;
  }
  return `Reminder: ${draft.title}`;
}
