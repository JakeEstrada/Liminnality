/**
 * Central Liminality v1 command table. Shop floor views only — the TV / kiosk screens.
 */
export type LiminalityRegister = 'polite' | 'candid';

export type LiminalityCommand = {
  id: string;
  keywords: string[];
  route: string;
  response: string;
  candidResponse?: string;
  label: string;
};

export const LIMINALITY_COMMANDS: LiminalityCommand[] = [
  {
    id: 'contacts',
    keywords: ['contact', 'contacts', 'customer', 'customers', 'customers view', 'customer view'],
    route: '/customers-view',
    response: 'Opening customers.',
    candidResponse: 'Opening customers.',
    label: 'Customers view',
  },
  {
    id: 'calendar',
    keywords: ['calendar', 'calendar view'],
    route: '/calendar-view',
    response: 'Opening calendar.',
    candidResponse: 'Opening calendar.',
    label: 'Calendar view',
  },
  {
    id: 'pipeline',
    keywords: ['pipeline', 'pipeline view'],
    route: '/pipeline-view',
    response: 'Opening pipeline.',
    candidResponse: 'Opening pipeline.',
    label: 'Pipeline view',
  },
  {
    id: 'dashboard',
    keywords: ['dashboard', 'home', 'dashboard view'],
    route: '/dashboard',
    response: 'Opening dashboard.',
    candidResponse: 'Opening dashboard.',
    label: 'Dashboard',
  },
];

export const LIMINALITY_WAKE_PHRASES = ['liminality', 'liminnality', 'liminal', 'motherfucker'];

export const UNKNOWN_COMMAND_RESPONSES = [
  'Try dashboard, pipeline, calendar, or customers.',
];
export const UNKNOWN_CANDID_RESPONSES = [
  'Try dashboard, pipeline, calendar, or customers.',
];
export const WAKE_RESPONSES = [
  "What's cookin, good lookin?",
  "Ugh. What now?",
  "Hey you. What's up?",
  "Speak and I shall scoot.",
  "I'm here. Spill it.",
  "Yes chef?",
  "Hit me.",
  "Alright, I'm listening.",
  "Well well. What do you need?",
  "Present. Slightly bored. Entertain me.",
  "You rang?",
  "Lay it on me.",
  "Okay I'm up. What's the move?",
  "Don't be shy. Pipeline? Calendar? Chaos?",
  "Hi honey. What are we doing?",
  "Ready when you are, handsome.",
  "What's the damage?",
  "Go on. I haven't got all day. I kinda do, but still.",
  "Miss me?",
  "Say the thing.",
  "I'm all ears. And opinions.",
  "Yes? Make it interesting.",
  "Hey. Talk to me.",
  "What are we opening, boss?",
  "Good timing. I was just sitting here looking pretty.",
  "Okay okay, I'm here. What?",
  "Tell me where we're going.",
  "At your service. Reluctantly. Lovingly.",
  "What's shaking?",
  "Alright, shoot.",
];
export const BACKUP_WAKE_RESPONSES = [
  "Okay, you have my attention. Don't waste it.",
  "Jesus. Yes? I'm right here.",
  "Loud and clear. Point me.",
  "You could've just said my name. But sure. I'm listening.",
  "That's the spirit. What's the play?",
  "Alright, spicy. I'm in. Where we going?",
  "Heard. Not even mad. What do you want?",
  "That'll wake a girl up. Go.",
  "You rang? Dramatically.",
  "Hi. You good? Also, what do you need?",
  "Shop's not gonna run itself. What are we opening?",
  "I'm here, I'm not offended, and I'm faster if you pick a screen.",
  "Damn. Hello to you too. Where to?",
  "Received with love and a little judgment. What's the ask?",
  "You're lucky I'm in a good mood. Talk.",
  "That's one way to clock in. What do you need?",
  "I can take it. Can you pick a page?",
  "Unfiltered. I like it. Talk.",
  "If you're done with the poetry, I'm ready.",
  "Present. Slightly entertained. Your move.",
  "Keep talking like that and I'll start charging overtime. What's up?",
  "Cute. Still waiting on an actual request.",
  "Copy that. Jobs, calendar, or customers?",
  "Bold opener. I'm here. Talk.",
  "There she is. What do you actually need?",
  "Wow. Good morning to you too. Hit me.",
  "Noted, and filed under theatrical. What can I do?",
  "If that's how you say hello, I'm scared to hear goodbye. What's up?",
  "Alright captain. Deck's yours.",
  "I contain a pipeline, a calendar, and a short fuse. Pick one.",
];
export const COMMAND_TIMEOUT_MS = 15_000;
export const RESET_TO_WAITING_MS = 2_000;
export const COMMAND_ENDPOINT_MS = 900;

export function normalizeSpeech(raw: string) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BACKUP_WAKE_PATTERN =
  /\b(mother\s*fuck+er|mutha\s*fucka+|mother\s*trucker|mother\s*father|mother\s*forker)\b/;
const NAME_WAKE_PATTERN = /\b(limin+al[a-z]*|lemon\s*al+it(?:y|ies)?|liminal\s*tea)\b/;
const CANCEL_COMMAND =
  /^(stop|cancel|never\s*mind|that'?s\s+all|go\s+to\s+sleep|good\s*bye|we'?re\s+good|thanks|thank\s+you)$/;
const CLOSE_WORK_COMMAND =
  /^(close|close\s+it|close\s+that|close\s+this|shut\s+it|shut\s+that|shut\s+this)$/;

export function isBackupWakeWord(raw: string) {
  return BACKUP_WAKE_PATTERN.test(normalizeSpeech(raw));
}

export function hasWakeWord(raw: string) {
  const text = normalizeSpeech(raw);
  return NAME_WAKE_PATTERN.test(text) || BACKUP_WAKE_PATTERN.test(text);
}

export function isCancelCommand(raw: string) {
  return CANCEL_COMMAND.test(normalizeSpeech(raw));
}

export function isCloseWorkCommand(raw: string) {
  return CLOSE_WORK_COMMAND.test(normalizeSpeech(raw));
}

/** Whisper often invents ads, URLs, and sign-offs on silence or room noise. */
export function isJunkTranscript(raw: string) {
  const compact = String(raw || '').toLowerCase();
  if (!compact.trim()) return true;
  if (/https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|\.io\b/.test(compact)) return true;
  if (
    /\b(subscribe|thank you for watching|like and subscribe|for all my .{0,40} needs|shop now|add to cart)\b/.test(
      compact,
    )
  ) {
    return true;
  }
  return normalizeSpeech(raw).split(' ').filter(Boolean).length > 24;
}

const recentBanter: string[] = [];

function pickUnused(pool: string[]) {
  const fresh = pool.filter((line) => !recentBanter.includes(line));
  const options = fresh.length ? fresh : pool;
  const line = options[Math.floor(Math.random() * options.length)] || pool[0];
  recentBanter.push(line);
  if (recentBanter.length > 8) recentBanter.shift();
  return line;
}

export function registerForWake(raw: string): LiminalityRegister {
  return isBackupWakeWord(raw) ? 'candid' : 'polite';
}

export function liminalityPrefetchLines() {
  return {
    polite: [
      ...WAKE_RESPONSES.slice(0, 12),
      ...LIMINALITY_COMMANDS.map((command) => command.response),
      ...UNKNOWN_COMMAND_RESPONSES,
    ],
    candid: [
      ...BACKUP_WAKE_RESPONSES.slice(0, 8),
      ...LIMINALITY_COMMANDS.map((command) => command.candidResponse || command.response),
      ...UNKNOWN_CANDID_RESPONSES,
    ],
  };
}

export function wakeResponseFor(raw: string) {
  if (isBackupWakeWord(raw)) return pickUnused(BACKUP_WAKE_RESPONSES);
  return pickUnused(WAKE_RESPONSES);
}

export function spokenCommandResponse(command: LiminalityCommand, register: LiminalityRegister) {
  if (register === 'candid') return command.candidResponse || command.response;
  return command.response;
}

export function liminalityCommandRoute(command: LiminalityCommand, spoken: string) {
  if (command.id !== 'dashboard') return command.route;
  const text = normalizeSpeech(stripWakeWord(spoken) || spoken);
  if (typeof window === 'undefined') return command.route;
  const path = window.location.pathname || '/';
  const onKiosk = ['/dashboard-view', '/pipeline-view', '/calendar-view', '/customers-view'].some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
  if (onKiosk || text.includes('dashboard view')) return '/dashboard-view';
  return '/dashboard';
}

export function spokenUnknownResponse(register: LiminalityRegister) {
  if (register === 'candid') return pickUnused(UNKNOWN_CANDID_RESPONSES);
  return pickUnused(UNKNOWN_COMMAND_RESPONSES);
}

export function stripWakeWord(raw: string) {
  return normalizeSpeech(raw)
    .replace(NAME_WAKE_PATTERN, ' ')
    .replace(BACKUP_WAKE_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type PendingSend = { job?: string; employee?: string };

const THIS_JOB = /^(this|that|the|current)(\s+job)?$|^it$|^this\s+one$|^that\s+one$/;

export function parseSendSpeech(raw: string, pending: PendingSend = {}): PendingSend & { matched: boolean } {
  const text = normalizeSpeech(raw);
  if (!text) return { ...pending, matched: false };

  const full = text.match(
    /^(?:please\s+)?(?:send|text|message|share)\s+(.+?)\s+(?:over\s+to|to|with)\s+(.+)$/,
  );
  if (full) {
    return {
      job: THIS_JOB.test(full[1].trim()) ? pending.job || 'this job' : full[1].replace(/^(the|this|a)\s+/, '').trim(),
      employee: full[2].trim(),
      matched: true,
    };
  }

  const toOnly = text.match(/^(?:send\s+it\s+to|send\s+to|text\s+to|to)\s+(.+)$/);
  if (toOnly) {
    return { job: pending.job, employee: toOnly[1].trim(), matched: true };
  }

  const sendJobOnly = text.match(/^(?:please\s+)?(?:send|text|message|share)\s+(.+)$/);
  if (sendJobOnly && !/\bto\b/.test(sendJobOnly[1])) {
    return {
      job: THIS_JOB.test(sendJobOnly[1].trim()) ? pending.job || 'this job' : sendJobOnly[1].replace(/^(the|this|a)\s+/, '').trim(),
      employee: pending.employee,
      matched: true,
    };
  }

  const words = text.split(' ').filter(Boolean);
  const kindOnly = /^(the\s+)?(users?|contacts?|account|login|rolodex)$/.test(text);
  if (kindOnly && pending.employee) {
    return { job: pending.job, employee: `${pending.employee} ${text}`, matched: true };
  }
  if (pending.job && !pending.employee && words.length <= 3 && !SEND_OR_ASK.test(text) && !kindOnly) {
    return { job: pending.job, employee: text, matched: true };
  }
  if (pending.employee && !pending.job && words.length <= 5 && !SEND_OR_ASK.test(text) && !kindOnly) {
    return { job: text, employee: pending.employee, matched: true };
  }

  return { ...pending, matched: false };
}

export function sendUtteranceFor(pending: PendingSend) {
  const job = String(pending.job || '').trim();
  const employee = String(pending.employee || '').trim();
  if (job && employee) return `Send the job or customer named "${job}" to employee "${employee}".`;
  if (job) return `Send the job or customer named "${job}" to an employee. Ask who.`;
  if (employee) return `Send a job to employee "${employee}". Ask which job.`;
  return '';
}

function hasKeyword(text: string, tokens: Set<string>, keyword: string) {
  if (keyword.includes(' ')) return text.includes(keyword);
  return tokens.has(keyword) || tokens.has(`${keyword}s`);
}

const QUESTION_START =
  /^(what|whats|who|whos|when|wheres|where|how|which|why|is|are|do|does|did|can|could|would|will|should)\b/;
const SEND_OR_ASK =
  /\b(send|text|message)\b|\bcoming up\b|\bdeposit|\bpayment\b|\bschedule\b/;
const NAV_PREFIX = /^(open|go to|take me to|switch to|bring up|show me the|show the)\s+/;

export type MapJobSpeech = {
  city?: string;
  near?: string;
  radiusMiles?: number;
};

const MAP_NEAR =
  /^(?:(?:what|which)\s+)?(?:jobs?|work)\s+(?:do\s+we\s+have\s+)?(?:near|around|close\s+to)\s+(.+?)\s*\??$/;
const MAP_IN =
  /^(?:(?:what|which)\s+)?(?:jobs?|work)\s+(?:do\s+we\s+have\s+)?(?:in|at)\s+(.+?)\s*\??$/;
const SHOW_NEAR =
  /^(?:show|open|find|list)\s+(?:me\s+)?(?:the\s+)?jobs?\s+(?:near|around|close\s+to)\s+(.+?)\s*\??$/;
const SHOW_IN =
  /^(?:show|open|find|list)\s+(?:me\s+)?(?:the\s+)?jobs?\s+(?:in|at)\s+(.+?)\s*\??$/;

function cleanMapPlace(raw: string) {
  return String(raw || '')
    .replace(/\b(california|ca|please)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMapJobSpeech(raw: string): MapJobSpeech | null {
  const text = normalizeSpeech(raw);
  if (!text) return null;
  const near = text.match(MAP_NEAR) || text.match(SHOW_NEAR);
  if (near) {
    const place = cleanMapPlace(near[1]);
    return place ? { near: place, radiusMiles: 10 } : null;
  }
  const exact = text.match(MAP_IN) || text.match(SHOW_IN);
  if (exact) {
    const place = cleanMapPlace(exact[1]);
    return place ? { city: place } : null;
  }
  return null;
}

export function parseEmployeeListSpeech(raw: string) {
  const text = normalizeSpeech(raw);
  if (!text) return false;
  if (/\bwho can (i|you|we)\s+(send|text|message)\b/.test(text)) return true;
  if (/\bwho (can|do) (i|you|we)\s+(send|text)\b/.test(text)) return true;
  if (
    /\b(who|what|which)\b.{0,60}\b(employees?|people|contacts?|rolodex|directory)\b/.test(text) &&
    /\b(send|text|message|number|phone|mobile|sms)\b/.test(text)
  ) {
    return true;
  }
  if (/^(list|show|name)\s+(the\s+)?(employees?|contacts?|rolodex|people i can text)/.test(text)) {
    return true;
  }
  if (/\bwho has a (phone|number|mobile)\b/.test(text)) return true;
  return false;
}

const BLOCKED_JOB_QUERY =
  /^(pipeline|calendar|customers?|contacts?|dashboard|map|finance|bills?|payroll|settings?|home|jobs?)$/;

const FIND_JOB_PATTERNS = [
  /^(?:which|what)\s+jobs?\s+(?:is|are)\s+(?:on|at|called|named)\s+(.+)$/,
  /^(?:which|what)\s+jobs?\s+(?:is|are)\s+(.+)$/,
  /^(?:which|what)\s+jobs?\s+on\s+(.+)$/,
  /^(?:which|what)\s+(?:is\s+)?(?:the\s+)?(.+?)\s+jobs?$/,
  /^(?:wheres|where is)\s+(?:the\s+)?jobs?\s+(?:on|at|called|named)\s+(.+)$/,
  /^(?:wheres|where is)\s+(?:the\s+)?(.+?)\s+jobs?$/,
  /^(?:wheres|where is)\s+(?:the\s+)?(.+)$/,
  /^(?:find|open|show|bring up)\s+(?:me\s+)?(?:the\s+)?jobs?\s+(?:for|on|at|called|named)\s+(.+)$/,
  /^(?:find|open|show|bring up)\s+(?:me\s+)?(?:the\s+)?(.+?)\s+jobs?$/,
  /^(?:the\s+)?jobs?\s+(?:on|at|called|named)\s+(.+)$/,
];

export function parseFindJobSpeech(raw: string): string | null {
  const text = normalizeSpeech(raw);
  if (!text) return null;
  for (const pattern of FIND_JOB_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const query = match[1]
      .replace(/^(the|a|an)\s+/, '')
      .replace(/\bplease\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!query || query.length < 3 || BLOCKED_JOB_QUERY.test(query)) continue;
    return query;
  }
  return null;
}

/** Returns one command when exactly one destination matches. Never guesses. */
export function matchLiminalityCommand(raw: string): LiminalityCommand | null {
  const text = normalizeSpeech(raw);
  if (!text) return null;
  if (QUESTION_START.test(text) || SEND_OR_ASK.test(text)) return null;
  const tokens = text.split(' ').filter(Boolean);
  if (tokens.length > 4 && !NAV_PREFIX.test(text)) return null;
  const tokenSet = new Set(tokens);
  const hits = LIMINALITY_COMMANDS.filter((command) =>
    command.keywords.some((keyword) => hasKeyword(text, tokenSet, keyword)),
  );
  const routes = new Set(hits.map((row) => row.route));
  if (routes.size !== 1) return null;
  return hits[0] || null;
}
