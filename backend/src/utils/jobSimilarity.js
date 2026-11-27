/** Worksheet-note lines written by worksheetJobNote. Other notes stay out of the fingerprint. */
const WORKSHEET_LINE =
  /^(?:Gate code:|Scope:|Options:|Other contact:|Ref:|Worksheet date:|Marked Contractor on the worksheet)/m;

const DEFAULT_MIN_SCORE = 0.45;
const DEFAULT_LIMIT = 5;

function looksLikeWorksheetNote(content) {
  return WORKSHEET_LINE.test(String(content || '').trim());
}

/** Text compared for similar jobs: the worksheet note only. */
function worksheetFingerprintText(notes) {
  const parts = [];
  for (const note of notes || []) {
    if (!note || note.isSms || note.isStageChange || note.isAppointment) continue;
    const content = String(note.content || '').trim();
    if (!content) continue;
    if (!note.isWorksheet && !looksLikeWorksheetNote(content)) continue;
    parts.push(content);
  }
  return parts.join('\n\n').slice(0, 8000);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const x = Number(left[i]);
    const y = Number(right[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    leftNorm += x * x;
    rightNorm += y * y;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function rankFingerprints(query, rows, options = {}) {
  const excludeJobId = options.excludeJobId ? String(options.excludeJobId) : '';
  const minScore = Number.isFinite(options.minScore) ? options.minScore : DEFAULT_MIN_SCORE;
  const limit = Math.max(1, Math.min(Number(options.limit) || DEFAULT_LIMIT, 8));
  const scored = [];
  for (const row of rows || []) {
    const id = String(row?.jobId || '');
    if (!id || (excludeJobId && id === excludeJobId)) continue;
    const score = cosineSimilarity(query, row?.embedding);
    if (score < minScore) continue;
    scored.push({ jobId: row.jobId, text: String(row.text || ''), score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function noteSnippet(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 220) return clean;
  return `${clean.slice(0, 217)}...`;
}

module.exports = {
  DEFAULT_MIN_SCORE,
  looksLikeWorksheetNote,
  worksheetFingerprintText,
  cosineSimilarity,
  rankFingerprints,
  noteSnippet,
};
