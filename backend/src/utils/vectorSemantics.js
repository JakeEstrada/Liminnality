const { cosineSimilarity } = require('./jobSimilarity');
const { keywordStems } = require('./jobMemoryQuery');

const SEARCH_KEEP_SCORE = 0.38;
const GENERIC_STEMS = new Set([
  'scope', 'gate', 'code', 'option', 'worksheet', 'date', 'mark', 'contractor',
  'install', 'note', 'line', 'job',
]);

function roundScore(score) {
  return Math.round(Number(score) * 100) / 100;
}

function excerpt(text, limit = 280) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1)}…`;
}

function kindLabel(kind) {
  if (kind === 'worksheet') return 'worksheet line';
  if (kind === 'task') return 'task';
  if (kind === 'crew') return 'crew note';
  return 'note';
}

function previewNumbers(embedding, count = 8) {
  return (Array.isArray(embedding) ? embedding : []).slice(0, count).map((value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(number * 100) / 100;
  });
}

/** Angle-bracket sketch of the first numbers, with the rest left as an ellipsis. */
function formatVectorPreview(embedding, count = 8) {
  const nums = previewNumbers(embedding, count);
  if (!nums.length) return '<……>';
  return `<${nums.map((number) => number.toFixed(2)).join(', ')}, ……>`;
}

function preferLine(rows) {
  if (!rows?.length) return null;
  const scope = rows.find((row) => /scope:/i.test(String(row?.text || '')));
  if (scope) return scope;
  return rows.slice().sort((a, b) => String(b?.text || '').length - String(a?.text || '').length)[0];
}

function selectExampleRow(rows, { query, jobId, memoryId, jobIds } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (memoryId) {
    const found = list.find((row) => String(row?._id) === String(memoryId));
    if (found) return found;
  }
  if (jobId) {
    const picked = preferLine(list.filter((row) => String(row?.jobId) === String(jobId)));
    if (picked) return picked;
  }
  if (Array.isArray(jobIds) && jobIds.length) {
    for (const id of jobIds) {
      const picked = preferLine(list.filter((row) => String(row?.jobId) === String(id)));
      if (picked) return picked;
    }
  }
  const needle = String(query || '').trim().toLowerCase();
  if (needle) {
    const textHit = list.find((row) => String(row?.text || '').toLowerCase().includes(needle));
    if (textHit) return textHit;
  }
  return preferLine(list.filter((row) => row?.kind === 'worksheet')) || list[0] || null;
}

function nearestOtherJobs(target, rows, limit = 5) {
  const cap = Math.max(1, Math.min(Number(limit) || 5, 8));
  const best = new Map();
  const targetJob = String(target?.jobId || '');
  for (const row of rows || []) {
    const jobId = String(row?.jobId || '');
    if (!jobId || jobId === targetJob) continue;
    const score = cosineSimilarity(target?.embedding, row?.embedding);
    const current = best.get(jobId);
    if (!current || score > current.score) best.set(jobId, { row, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, cap);
}

function otherLinesOnJob(target, rows, limit = 4) {
  const cap = Math.max(1, Math.min(Number(limit) || 4, 8));
  const targetId = String(target?._id || '');
  const targetJob = String(target?.jobId || '');
  return (rows || [])
    .filter((row) => String(row?.jobId || '') === targetJob && String(row?._id || '') !== targetId)
    .map((row) => ({ row, score: cosineSimilarity(target?.embedding, row?.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap);
}

/** One row per job that has a stored vector. The representative line is the worksheet scope when there is one. */
function listJobsWithVectors(rows) {
  const byJob = new Map();
  for (const row of rows || []) {
    const jobId = String(row?.jobId || '');
    if (!jobId) continue;
    const bucket = byJob.get(jobId);
    if (bucket) bucket.push(row);
    else byJob.set(jobId, [row]);
  }
  return [...byJob.entries()].map(([jobId, lines]) => {
    const row = preferLine(lines);
    return {
      jobId,
      lineCount: lines.length,
      memoryId: String(row?._id || ''),
    };
  });
}

function describeJobList(entries, jobs) {
  return (entries || [])
    .map((entry) => {
      const label = jobLabel(jobs, entry.jobId);
      return {
        jobId: entry.jobId,
        memoryId: entry.memoryId,
        lineCount: entry.lineCount,
        jobTitle: label.jobTitle,
        customerName: label.customerName,
      };
    })
    .sort((a, b) => a.jobTitle.localeCompare(b.jobTitle, 'en', { sensitivity: 'base' }));
}

function jobLabel(jobs, jobId) {
  const job = jobs?.get?.(String(jobId));
  return {
    jobTitle: job?.jobTitle || job?.title || 'Untitled',
    customerName: job?.customerName || null,
  };
}

function describeLine(row, jobs, score) {
  const label = jobLabel(jobs, row?.jobId);
  return {
    memoryId: String(row?._id || ''),
    jobId: String(row?.jobId || ''),
    jobTitle: label.jobTitle,
    customerName: label.customerName,
    kind: row?.kind || 'note',
    kindLabel: kindLabel(row?.kind),
    text: String(row?.text || '').slice(0, 700),
    excerpt: excerpt(row?.text),
    score: score == null ? null : roundScore(score),
  };
}

function describeExample(row, jobs) {
  const embedding = Array.isArray(row?.embedding) ? row.embedding : [];
  return {
    ...describeLine(row, jobs, null),
    dimensions: embedding.length,
    preview: previewNumbers(embedding, 8),
    previewText: formatVectorPreview(embedding, 8),
  };
}

function meaningfulSharedWords(left, right) {
  const stems = new Set(keywordStems(left).filter((stem) => !GENERIC_STEMS.has(stem)));
  return keywordStems(right).filter((stem) => stems.has(stem) && !GENERIC_STEMS.has(stem));
}

function buildVectorDetail(example, neighbors, sameJob, meta = {}) {
  const model = meta.model || 'text-embedding-3-small';
  const top = neighbors?.[0];
  const paragraphs = [
    `${example.jobTitle} is on the page as ${example.previewText}. That is the start of a list of ${example.dimensions} numbers. ${model} made the list from one ${example.kindLabel}, the whole line at once: “${example.excerpt}”`,
    `A number in that list is not a word, and the list is not a serial number for the job. The job id stored beside the list is ${example.jobId}. That id is what identifies ${example.jobTitle}.${example.customerName && example.customerName !== example.jobTitle ? ` The customer on the job is ${example.customerName}.` : ''}`,
  ];
  if (top) {
    const shared = meaningfulSharedWords(example.text, top.text);
    const share = shared.length
      ? `Some of the same words show up in both lines: ${shared.join(', ')}.`
      : 'The lines can sit near each other even when the words are different.';
    const kept = top.score >= SEARCH_KEEP_SCORE
      ? 'A normal note search keeps a loose match from about 0.38 up, so this one would be kept.'
      : 'A normal note search keeps a loose match from about 0.38 up, so this one would be left out.';
    paragraphs.push(
      `The closest other job is ${top.jobTitle} at ${Number(top.score).toFixed(2)}. ${share} ${kept} The score is cosine similarity: 1 would mean the two lists point the same way. Similar jobs on the pipeline is a separate list, one worksheet note per job, and it starts keeping matches around 0.45.`,
    );
  } else {
    paragraphs.push('No other job has a stored line to compare yet.');
  }
  paragraphs.push(
    'The numbers do not follow “instead of” or “not”. A date is stored separately. “Last week” means the previous shop week, Friday through Thursday, and that filter uses notes and tasks. Worksheet lines stay in a question that has no date, because the day the worksheet was scraped is not the day the work was ordered.',
  );
  if (sameJob?.length) {
    paragraphs.push(
      `This job has more than one list. Another line on ${example.jobTitle} is a ${sameJob[0].kindLabel}: “${sameJob[0].excerpt}” It has its own ${example.dimensions} numbers.`,
    );
  }
  const count = Number(meta.storedLines);
  paragraphs.push(
    `${Number.isFinite(count) && count > 0 ? count : 'The'} stored lines were compared for this page. Ask below why a job is close, or what one of the numbers is. The answer stays on these lines.`,
  );
  return paragraphs;
}

function answerVectorQuestion(question, example, neighbors) {
  const asked = String(question || '').toLowerCase();
  const top = neighbors?.[0];
  if (/number|what is a vector|what is the vector|dimension/.test(asked)) {
    const sample = example?.preview?.[0];
    return `The list on ${example.jobTitle} has ${example.dimensions} numbers. The first one is ${sample}. That number is not a word from the line. The line was read all at once: “${example.excerpt}”. The job id ${example.jobId} is what identifies the job.`;
  }
  if (top) {
    const shared = meaningfulSharedWords(example.text, top.text);
    const share = shared.length
      ? `Both lines carry ${shared.join(', ')}.`
      : 'The words do not have to match. The score is only how near the two lists point.';
    const instead = /\binstead\b|\bnot\b|\brather\b/.test(asked)
      ? ' The list does not understand “instead of” or “not”, so a line that says the opposite can still sit nearby.'
      : '';
    const kept = top.score >= SEARCH_KEEP_SCORE
      ? 'Search would keep a score like this.'
      : 'Search would leave out a score this low.';
    return `${example.jobTitle} and ${top.jobTitle} score ${Number(top.score).toFixed(2)}. ${share}${instead} ${kept} ${top.jobTitle} says: “${top.excerpt}”.`;
  }
  return `${example.jobTitle} is one list of ${example.dimensions} numbers for “${example.excerpt}”. Nothing else is stored to compare.`;
}

module.exports = {
  SEARCH_KEEP_SCORE,
  excerpt,
  kindLabel,
  previewNumbers,
  formatVectorPreview,
  selectExampleRow,
  listJobsWithVectors,
  describeJobList,
  nearestOtherJobs,
  otherLinesOnJob,
  describeExample,
  describeLine,
  buildVectorDetail,
  answerVectorQuestion,
};
