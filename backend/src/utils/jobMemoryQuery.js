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
