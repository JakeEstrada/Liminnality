const { looksLikeWorksheetNote, cosineSimilarity } = require('./jobSimilarity');

const MEMORY_MIN_SCORE = 0.38;

const SHOP_TIMEZONE = 'America/Los_Angeles';

const STOP_WORDS = new Set([
  'what', 'which', 'who', 'jobs', 'job', 'did', 'does', 'do', 'i', 'we', 'you',
  'for', 'the', 'a', 'an', 'last', 'week', 'this', 'month', 'me', 'my', 'our',
  'to', 'of', 'on', 'in', 'and', 'or', 'about', 'show', 'find', 'any', 'there',
  'was', 'were', 'have', 'has', 'had', 'with', 'from', 'that', 'those', 'these',
  'please', 'when', 'where', 'how', 'many', 'all', 'get', 'got', 'need', 'needed',
]);

function stemWord(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Words worth matching. "ordered balusters last week" becomes order + baluster. */
function keywordStems(query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  const stems = [];
  for (const word of words) {
    const stem = stemWord(word);
    if (stem.length >= 3 && !stems.includes(stem)) stems.push(stem);
  }
  return stems;
}

function textHasStems(text, stems) {
  if (!stems.length) return true;
  const hay = String(text || '').toLowerCase();
  return stems.every((stem) => hay.includes(stem));
}

const RECENCY_WORDS = new Set(['recent', 'latest', 'newest', 'list', 'most', 'can']);
const QUESTION_WORDS = new Set(['upcoming', 'upcom', 'use', 'using', 'currently', 'current', 'today']);

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

/** Contract out through ready to schedule. Estimates before that, and work already scheduled, stay out. */
const UPCOMING_STAGES = new Set([
  'CONTRACT_OUT',
  'CONTRACT_SIGNED',
  'DEPOSIT_PENDING',
  'JOB_PREP',
  'TAKEOFF_COMPLETE',
  'READY_TO_SCHEDULE',
]);

function wordToNumber(word) {
  const text = String(word || '').toLowerCase();
  if (NUMBER_WORDS[text]) return NUMBER_WORDS[text];
  const value = Number(text);
  return Number.isFinite(value) ? value : text;
}

/** "four and a quarter" becomes 4.25 so a spoken size matches the worksheet. */
function normalizeShopQuery(query) {
  const ones = 'one|two|three|four|five|six|seven|eight|nine|\\d+';
  let text = String(query || '');
  text = text.replace(new RegExp(`\\b(${ones})\\s+and\\s+three\\s+quarters\\b`, 'ig'), (_, n) => `${wordToNumber(n)}.75`);
  text = text.replace(new RegExp(`\\b(${ones})\\s+and\\s+(?:a|an|one)\\s+half\\b`, 'ig'), (_, n) => `${wordToNumber(n)}.5`);
  text = text.replace(new RegExp(`\\b(${ones})\\s+and\\s+(?:a|an|one)\\s+quarter\\b`, 'ig'), (_, n) => `${wordToNumber(n)}.25`);
  return text;
}

function asksForUpcoming(query) {
  const text = String(query || '');
  if (/\bupcoming\b/i.test(text) || /\bright now\b/i.test(text)) return true;
  return /\bcontract out\b/i.test(text) && /\bready to schedule\b/i.test(text);
}

function focusForQuery(query, scope) {
  const picked = String(scope || '').toLowerCase();
  if (picked === 'upcoming' || picked === 'archived' || picked === 'all') return picked;
  if (asksForUpcoming(query)) return 'upcoming';
  if (/\barchived\b/i.test(String(query || ''))) return 'archived';
  return 'all';
}

function jobMatchesFocus(job, focus) {
  if (focus === 'upcoming') {
    if (!job || job.isArchived || job.isDeadEstimate || job.isCompletedClosedOut) return false;
    return UPCOMING_STAGES.has(job.stage);
  }
  if (focus === 'archived') return Boolean(job?.isArchived);
  return true;
}

/** Stems for a search, without the words that only ask for newest-first or a stage window. */
function searchStems(query) {
  const normalized = normalizeShopQuery(query);
  const skip = new Set([...RECENCY_WORDS, ...QUESTION_WORDS]);
  if (/\bright now\b/i.test(normalized)) {
    skip.add('right');
    skip.add('now');
  }
  if (asksForUpcoming(normalized)) {
    skip.add('contract');
    skip.add('ready');
    skip.add('schedule');
    skip.add('scheduled');
    skip.add('schedul');
  }
  const tokens = new Set(exactTokens(normalized));
  return keywordStems(normalized).filter((stem) => !skip.has(stem) && !tokens.has(stem));
}

/** Sizes and part numbers that must match exactly. "4.25" is not "4.5". "7084" is not "17084". */
function exactTokens(query) {
  const raw = normalizeShopQuery(query);
  const tokens = [];
  const add = (token) => {
    const value = String(token || '').toLowerCase();
    if (value && !tokens.includes(value)) tokens.push(value);
  };
  for (const match of raw.matchAll(/\d+\.\d+/g)) add(match[0]);
  for (const match of raw.matchAll(/(?<![\d.])\d{3,}(?![\d.])/g)) add(match[0]);
  return tokens;
}

function textHasExactTokens(text, tokens) {
  const hay = String(text || '');
  return (tokens || []).every((token) => {
    const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\d.])${escaped}(?!\\d)(?!\\.\\d)`, 'i').test(hay);
  });
}

function asksForRecent(query) {
  return /\b(?:most recent|latest|newest)\b/i.test(String(query || ''));
}

/** The date written on the worksheet, not the day the file was scraped. */
function worksheetDate(text) {
  const match = String(text || '').match(/worksheet date:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/i);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function recencyTime(row) {
  const dated = worksheetDate(row?.text);
  if (dated) return dated.getTime();
  const at = row?.at ? new Date(row.at).getTime() : 0;
  return Number.isNaN(at) ? 0 : at;
}

function recencyYmd(row) {
  const dated = worksheetDate(row?.text);
  if (dated) return dated.toISOString().slice(0, 10);
  if (!row?.at) return null;
  const at = new Date(row.at);
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString().slice(0, 10);
}

/**
 * Jobs whose stored lines contain every keyword, size, and part number.
 * "skirting" matches skirt. "treads" matches tread. "4.25" does not match "4.5".
 * Newest worksheet date first. Returns null when the question has nothing to match.
 */
function rankExactMatches(rows, query, options = {}) {
  const tokens = exactTokens(query);
  const stems = searchStems(query).filter((stem) => !tokens.includes(stem));
  if (!tokens.length && !stems.length) return null;
  const cap = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const from = options.from instanceof Date ? options.from.getTime() : null;
  const to = options.to instanceof Date ? options.to.getTime() : null;
  const best = new Map();
  for (const row of rows || []) {
    if (!row || isStageLog(row.text)) continue;
    if (!textHasExactTokens(row.text, tokens)) continue;
    if (stems.length && !textHasStems(row.text, stems)) continue;
    const when = recencyTime(row);
    if (from != null && when < from) continue;
    if (to != null && when > to) continue;
    const id = String(row.jobId || '');
    if (!id) continue;
    const current = best.get(id);
    if (!current || when > current.when) best.set(id, { row, when });
  }
  return [...best.values()].sort((a, b) => b.when - a.when).slice(0, cap);
}

/** Stage moves are shop bookkeeping, not something that was ordered. */
function isStageLog(text) {
  const line = String(text || '').trim();
  return /^(?:stage updated|stage changed)\b/i.test(line)
    || /^job moved to archive\b/i.test(line)
    || /^auto-moved\b/i.test(line);
}

function asksAboutOrders(query) {
  return keywordStems(query).includes('order');
}

function lineMentionsOrder(text) {
  return /\b(?:re)?orders?\b|\border(?:ed|ing)\b|\bpurchased?\b|\bp\.?o\.?\b/i.test(String(text || ''));
}

function shopYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addCalendarDays(ymd, days) {
  const [year, month, day] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function weekdayIndex(ymd) {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Shop week is Friday through Thursday. */
function shopWeekContaining(ymd) {
  const sinceFriday = (weekdayIndex(ymd) + 7 - 5) % 7;
  const start = addCalendarDays(ymd, -sinceFriday);
  return { start, end: addCalendarDays(start, 6) };
}

function shopWeekLabel(date = new Date()) {
  const today = shopYmd(date);
  const thisWeek = shopWeekContaining(today);
  const lastWeek = {
    start: addCalendarDays(thisWeek.start, -7),
    end: addCalendarDays(thisWeek.end, -7),
  };
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIMEZONE,
    weekday: 'long',
  }).format(date);
  return { today, weekday, thisWeek, lastWeek };
}

function losAngelesOffset(ymd) {
  const probe = new Date(`${ymd}T20:00:00Z`);
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIMEZONE,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(probe)
    .find((part) => part.type === 'timeZoneName')?.value || 'GMT-8';
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return '-08:00';
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] || '00'}`;
}

function parseShopBound(value, end) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const clock = end ? '23:59:59.999' : '00:00:00.000';
    const parsed = new Date(`${raw}T${clock}${losAngelesOffset(raw)}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function latestTime(values) {
  const times = values
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && !Number.isNaN(value.getTime()));
  times.sort((a, b) => b - a);
  return times[0] || null;
}

function jobMemoryRows(job) {
  const rows = [];
  for (const note of job?.notes || []) {
    const text = String(note?.content || '').trim().slice(0, 2000);
    if (!text || !note?._id) continue;
    if (note.isStageChange || note.isSms || note.isAppointment || isStageLog(text)) continue;
    const worksheet = Boolean(note.isWorksheet) || looksLikeWorksheetNote(text);
    rows.push({
      kind: worksheet ? 'worksheet' : 'note',
      sourceId: String(note._id),
      text,
      at: note.createdAt || job.updatedAt || null,
    });
  }
  const crew = String(job?.schedule?.crewNotes || '').trim().slice(0, 2000);
  if (crew) {
    rows.push({
      kind: 'crew',
      sourceId: 'crew',
      text: crew,
      at: job?.updatedAt || null,
    });
  }
  return rows;
}

/** Closest rows by vector. One hit per job, highest score first. */
function rankMemoryHits(queryVector, rows, options = {}) {
  const minScore = Number.isFinite(options.minScore) ? options.minScore : MEMORY_MIN_SCORE;
  const limit = Math.max(1, Math.min(Number(options.limit) || 12, 30));
  const best = new Map();
  for (const row of rows || []) {
    const score = cosineSimilarity(queryVector, row?.embedding);
    if (score < minScore) continue;
    const id = String(row?.jobId || '');
    if (!id) continue;
    const current = best.get(id);
    if (!current || score > current.score) best.set(id, { row, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function taskMemoryRow(task) {
  if (!task?.jobId || !task?._id) return null;
  const pieces = [task.title, task.description];
  for (const row of [...(task.notes || []), ...(task.updates || [])]) {
    if (row?.content) pieces.push(row.content);
  }
  const text = pieces
    .map((piece) => String(piece || '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  if (!text) return null;
  const times = [task.createdAt, task.completedAt, task.updatedAt];
  for (const row of [...(task.notes || []), ...(task.updates || [])]) times.push(row?.createdAt);
  return {
    jobId: task.jobId,
    tenantId: task.tenantId || null,
    kind: 'task',
    sourceId: String(task._id),
    text,
    at: latestTime(times),
  };
}

module.exports = {
  keywordStems,
  textHasStems,
  searchStems,
  exactTokens,
  textHasExactTokens,
  normalizeShopQuery,
  asksForUpcoming,
  focusForQuery,
  jobMatchesFocus,
  UPCOMING_STAGES,
  asksForRecent,
  worksheetDate,
  recencyYmd,
  rankExactMatches,
  isStageLog,
  asksAboutOrders,
  lineMentionsOrder,
  shopYmd,
  shopWeekContaining,
  shopWeekLabel,
  parseShopBound,
  MEMORY_MIN_SCORE,
  rankMemoryHits,
  jobMemoryRows,
  taskMemoryRow,
};
