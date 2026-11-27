const Job = require('../models/Job');
const JobMemory = require('../models/JobMemory');
require('../models/Customer');
const { embeddingConfigured, embedText, embedTexts } = require('./jobFingerprint');
const {
  keywordStems,
  textHasStems,
  exactTokens,
  searchStems,
  asksForRecent,
  recencyYmd,
  rankExactMatches,
  isStageLog,
  asksAboutOrders,
  lineMentionsOrder,
  parseShopBound,
  rankMemoryHits,
  jobMemoryRows,
  taskMemoryRow,
} = require('../utils/jobMemoryQuery');

const DATED_KINDS = ['note', 'task'];

function schedule(work) {
  setImmediate(() => {
    Promise.resolve()
      .then(work)
      .catch((error) => {
        console.error('Job memory failed:', error?.message || error);
      });
  });
}

function scheduleJobMemory(job) {
  if (!job?._id) return;
  const snapshot = {
    _id: job._id,
    tenantId: job.tenantId,
    notes: job.notes,
    schedule: job.schedule,
    updatedAt: job.updatedAt,
  };
  schedule(() => refreshJobMemory(snapshot));
}

function scheduleTaskMemory(task) {
  if (!task?._id) return;
  schedule(() => refreshTaskMemory(task));
}

function sameVector(row, previous) {
  return Boolean(
    previous
    && previous.text === row.text
    && Array.isArray(previous.embedding)
    && previous.embedding.length,
  );
}

async function fillMissingVectors(rows) {
  const missing = rows.filter((row) => !Array.isArray(row.embedding) || row.embedding.length === 0);
  if (!missing.length || !embeddingConfigured()) return;
  try {
    const vectors = await embedTexts(missing.map((row) => row.text));
    missing.forEach((row, index) => {
      row.embedding = vectors[index];
      row.embeddedAt = new Date();
    });
  } catch (error) {
    console.error('Job memory vector skipped:', error.message);
  }
}

async function refreshJobMemory(job) {
  if (!job?._id) return { saved: 0 };
  const filter = { jobId: job._id, kind: { $in: ['note', 'worksheet', 'crew'] } };
  if (job.tenantId) filter.tenantId = job.tenantId;
  const existing = await JobMemory.find(filter).select('kind sourceId text embedding embeddedAt').lean();
  const previous = new Map(existing.map((row) => [`${row.kind}:${row.sourceId}`, row]));
  const rows = jobMemoryRows(job).map((row) => {
    const saved = previous.get(`${row.kind}:${row.sourceId}`);
    const next = {
      ...row,
      jobId: job._id,
      ...(job.tenantId ? { tenantId: job.tenantId } : {}),
    };
    if (sameVector(next, saved)) {
      next.embedding = saved.embedding;
      next.embeddedAt = saved.embeddedAt;
    }
    return next;
  });
  await fillMissingVectors(rows);
  await JobMemory.deleteMany(filter);
  if (!rows.length) return { saved: 0 };
  await JobMemory.insertMany(rows, { ordered: false });
  return { saved: rows.length };
}

async function refreshTaskMemory(task) {
  const row = taskMemoryRow(task);
  if (!row) {
    if (task?._id) {
      await JobMemory.deleteMany({ kind: 'task', sourceId: String(task._id) });
    }
    return { saved: 0 };
  }
  const filter = { jobId: row.jobId, kind: 'task', sourceId: row.sourceId };
  if (row.tenantId) filter.tenantId = row.tenantId;
  const existing = await JobMemory.findOne(filter).select('text embedding embeddedAt').lean();
  const update = {
    jobId: row.jobId,
    kind: 'task',
    sourceId: row.sourceId,
    text: row.text,
    at: row.at,
    ...(row.tenantId ? { tenantId: row.tenantId } : {}),
  };
  if (sameVector(row, existing)) {
    update.embedding = existing.embedding;
    update.embeddedAt = existing.embeddedAt;
  } else if (embeddingConfigured()) {
    try {
      update.embedding = await embedText(row.text);
      update.embeddedAt = new Date();
    } catch (error) {
      console.error('Job memory vector skipped:', error.message);
    }
  }
  await JobMemory.findOneAndUpdate(filter, { $set: update }, { upsert: true });
  return { saved: 1 };
}

async function removeJobMemory(jobId) {
  if (!jobId) return;
  await JobMemory.deleteMany({ jobId });
}

async function removeTaskMemory(task) {
  if (!task?._id) return;
  await JobMemory.deleteMany({ kind: 'task', sourceId: String(task._id) });
}

async function memoryIsReady() {
  const count = await JobMemory.estimatedDocumentCount();
  return count > 0;
}

function jobStanding(job) {
  if (job?.isArchived) return 'archived';
  if (job?.isDeadEstimate) return 'dead estimate';
  if (job?.isCompletedClosedOut) return 'closed out';
  return 'active';
}

async function finishMemoryMatches(asked, ranked, { since, until, hint }) {
  const ordered = (ranked || []).map((hit) => ({
    jobId: String(hit.row?.jobId || ''),
    hit,
  })).filter((item) => item.jobId);
  const jobs = await Job.find({ _id: { $in: ordered.map((item) => item.jobId) } })
    .populate('customerId', 'name')
    .select('title customerId stage isArchived isDeadEstimate isCompletedClosedOut')
    .lean();
  const jobById = new Map(jobs.map((job) => [String(job._id), job]));
  const matches = [];
  for (const item of ordered) {
    const job = jobById.get(item.jobId);
    if (!job) continue;
    const line = item.hit.row;
    matches.push({
      jobId: item.jobId,
      jobTitle: job.title || 'Untitled',
      customerName: job.customerId?.name || null,
      stage: job.stage || null,
      standing: jobStanding(job),
      noteDate: recencyYmd(line) || dayLabel(line.at),
      excerpt: String(line.text || '').slice(0, 450),
      kind: line.kind,
      score: item.hit.score == null ? null : Math.round(item.hit.score * 100) / 100,
      path: `/pipeline?jobId=${item.jobId}`,
    });
  }
  return {
    query: asked,
    since: since || null,
    until: until || null,
    matches,
    totalJobs: matches.length,
    hint,
  };
}

function dayLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function searchStoredJobNotes({ query, since, until, limit = 15 } = {}) {
  const asked = String(query || '').trim();
  const tokens = exactTokens(asked);
  const wordStems = searchStems(asked).filter((stem) => !tokens.includes(stem));
  const from = parseShopBound(since, false);
  const to = parseShopBound(until, true);
  const dated = Boolean(from || to);
  if (tokens.length || wordStems.length) {
    const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const clauses = [
      ...tokens.map((token) => ({ text: { $regex: escape(token), $options: 'i' } })),
      ...wordStems.map((stem) => ({ text: { $regex: escape(stem), $options: 'i' } })),
    ];
    const rows = await JobMemory.find({ $and: clauses })
      .select('jobId kind text at')
      .limit(5000)
      .lean();
    const ranked = rankExactMatches(rows, asked, {
      limit: 100,
      from: asksForRecent(asked) ? null : from,
      to: asksForRecent(asked) ? null : to,
    }) || [];
    const loose = !ranked.length && /\b(?:instead|rather|similar|like)\b/i.test(asked);
    if (!loose) {
      const words = [...tokens, ...wordStems];
      const hint = tokens.length
        ? `Exact match on ${tokens.join(', ')}. Newest worksheet date first. A size has to match exactly, so 4.25 does not include 4.5. The other words have to be in the line too.`
        : `Jobs whose notes or worksheet lines contain ${words.join(', ')}. Newest worksheet date first. The words have to be in the line.`;
      return finishMemoryMatches(asked, ranked, { since, until, hint });
    }
  }
  const cap = Math.min(Math.max(Number(limit) || 15, 1), 30);
  const stems = keywordStems(query);
  const filter = {};
  if (dated) {
    filter.kind = { $in: DATED_KINDS };
    filter.at = {};
    if (from) filter.at.$gte = from;
    if (to) filter.at.$lte = to;
  }
  const orderQuestion = asksAboutOrders(asked);
  let queryVector = null;
  if (asked && embeddingConfigured()) {
    try {
      queryVector = await embedText(asked);
    } catch (error) {
      console.error('Job memory question vector skipped:', error.message);
    }
  }
  if (!queryVector && stems.length && !orderQuestion) {
    filter.$and = stems.map((stem) => ({ text: { $regex: stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }));
  }

  const rows = (await JobMemory.find(filter).select('jobId kind text at embedding').sort({ at: -1 }).limit(5000).lean())
    .filter((row) => !isStageLog(row.text))
    .filter((row) => !orderQuestion || lineMentionsOrder(row.text));
  const ranked = queryVector
    ? rankMemoryHits(queryVector, rows, { limit: cap })
    : rows
      .filter((row) => textHasStems(row.text, stems))
      .slice(0, cap)
      .map((row) => ({ row, score: null }));
  const byJob = new Map(ranked.map((hit) => [String(hit.row.jobId), [hit]]));

  const jobs = await Job.find({ _id: { $in: [...byJob.keys()] } })
    .populate('customerId', 'name')
    .select('title customerId stage isArchived isDeadEstimate isCompletedClosedOut')
    .lean();
  const jobById = new Map(jobs.map((job) => [String(job._id), job]));

  const matches = [];
  for (const [jobId, hits] of byJob) {
    const job = jobById.get(jobId);
    if (!job) continue;
    const closest = hits[0];
    const line = closest.row || closest;
    matches.push({
      jobId,
      jobTitle: job.title || 'Untitled',
      customerName: job.customerId?.name || null,
      stage: job.stage || null,
      standing: jobStanding(job),
      noteDate: dayLabel(line.at),
      excerpt: String(line.text || '').slice(0, 450),
      kind: line.kind,
      score: closest.score == null ? null : Math.round(closest.score * 100) / 100,
      path: `/pipeline?jobId=${jobId}`,
    });
    if (matches.length >= cap) break;
  }

  return {
    query: asked,
    since: since || null,
    until: until || null,
    matches,
    totalJobs: matches.length,
    hint: orderQuestion
      ? 'Order notes and tasks only. Stage changes are left out. An empty list means nothing in that range mentions an order.'
      : queryVector
        ? 'Ranked by loose similarity. A higher score means the stored line is closer in meaning, even when the words differ. Dated questions use notes and tasks from that shop week only. Stage changes are left out.'
        : dated
          ? 'Word match on notes and tasks written in that shop-week range. Vectors were not available for this question. Stage changes are left out.'
          : 'Word match across notes, tasks, and scraped worksheet text. Vectors were not available for this question. Stage changes are left out.',
  };
}

async function embedMissingMemory(log = () => {}) {
  const pending = await JobMemory.find({
    $or: [{ embedding: { $exists: false } }, { embedding: null }, { embedding: { $size: 0 } }],
  })
    .select('text')
    .lean();
  const batchSize = 64;
  let embedded = 0;
  for (let index = 0; index < pending.length; index += batchSize) {
    const batch = pending.slice(index, index + batchSize);
    const vectors = await embedTexts(batch.map((row) => row.text));
    await JobMemory.bulkWrite(
      batch.map((row, rowIndex) => ({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { embedding: vectors[rowIndex], embeddedAt: new Date() } },
        },
      })),
    );
    embedded += batch.length;
    log(embedded, pending.length);
  }
  return { embedded, pending: pending.length };
}

module.exports = {
  scheduleJobMemory,
  scheduleTaskMemory,
  refreshJobMemory,
  refreshTaskMemory,
  removeJobMemory,
  removeTaskMemory,
  memoryIsReady,
  searchStoredJobNotes,
  embedMissingMemory,
};
