const Job = require('../models/Job');
const JobFingerprint = require('../models/JobFingerprint');
const { STAGE_LABELS } = require('../utils/stageConfig');
const {
  worksheetFingerprintText,
  rankFingerprints,
  noteSnippet,
} = require('../utils/jobSimilarity');

const EMBED_URL = 'https://api.openai.com/v1/embeddings';

function openaiKey() {
  return process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENNAI_API_KEY || '';
}

function embeddingConfigured() {
  return Boolean(openaiKey());
}

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function embedTexts(inputs) {
  const list = (Array.isArray(inputs) ? inputs : [inputs]).map((text) => String(text || '').slice(0, 8000));
  if (!list.length) return [];
  const key = openaiKey();
  if (!key) {
    throw fail('Similar search needs an OpenAI key on the server', 'OPENAI_API_KEY_NOT_SET');
  }
  const model = (process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small').trim() || 'text-embedding-3-small';
  const response = await fetch(EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      input: list.length === 1 ? list[0] : list,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw fail(data?.error?.message || 'Could not build a vector', 'EMBED_FAILED');
  }
  const rows = Array.isArray(data?.data) ? [...data.data].sort((a, b) => (a.index || 0) - (b.index || 0)) : [];
  if (rows.length !== list.length || rows.some((row) => !Array.isArray(row.embedding) || row.embedding.length === 0)) {
    throw fail('A vector came back empty', 'EMBED_FAILED');
  }
  return rows.map((row) => row.embedding);
}

async function embedText(text) {
  const [vector] = await embedTexts([text]);
  return vector;
}

function fingerprintFilter(job) {
  const filter = { jobId: job._id };
  if (job.tenantId) filter.tenantId = job.tenantId;
  return filter;
}

/**
 * Rebuilds the stored fingerprint when the worksheet note changed.
 * Returns 'saved', 'unchanged', or 'cleared'. Throws if the embedding call fails.
 */
async function refreshJobFingerprint(job) {
  if (!job?._id) return 'cleared';
  const text = worksheetFingerprintText(job.notes);
  const filter = fingerprintFilter(job);
  if (!text) {
    await JobFingerprint.deleteOne(filter);
    return 'cleared';
  }
  const existing = await JobFingerprint.findOne(filter).select('text').lean();
  if (existing && existing.text === text) return 'unchanged';
  const embedding = await embedText(text);
  await JobFingerprint.findOneAndUpdate(
    filter,
    {
      $set: {
        jobId: job._id,
        ...(job.tenantId ? { tenantId: job.tenantId } : {}),
        text,
        embedding,
        embeddedAt: new Date(),
      },
    },
    { upsert: true },
  );
  return 'saved';
}

function noteSnapshot(job) {
  return {
    _id: job._id,
    tenantId: job.tenantId,
    notes: (job.notes || []).map((note) => ({
      content: note.content,
      isWorksheet: Boolean(note.isWorksheet),
      isSms: Boolean(note.isSms),
      isStageChange: Boolean(note.isStageChange),
      isAppointment: Boolean(note.isAppointment),
    })),
  };
}

/** Job save already succeeded. A fingerprint failure must not undo it. */
function scheduleJobFingerprint(job) {
  if (!job?._id) return;
  const snapshot = noteSnapshot(job);
  setImmediate(() => {
    refreshJobFingerprint(snapshot).catch((error) => {
      console.error('Job fingerprint failed:', error?.message || error);
    });
  });
}

async function removeJobFingerprint(jobId) {
  if (!jobId) return;
  await JobFingerprint.deleteOne({ jobId });
}

async function rememberFingerprint(job, text, embedding) {
  if (!job?._id || !text || !Array.isArray(embedding) || embedding.length === 0) return;
  await JobFingerprint.findOneAndUpdate(
    fingerprintFilter(job),
    {
      $set: {
        jobId: job._id,
        ...(job.tenantId ? { tenantId: job.tenantId } : {}),
        text,
        embedding,
        embeddedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function searchSimilarJobs({ jobId, text, limit = 5 }) {
  let queryText = String(text || '').trim().slice(0, 8000);
  const excludeJobId = jobId ? String(jobId) : '';
  let sourceJob = null;

  if (excludeJobId) {
    sourceJob = await Job.findById(excludeJobId).select('tenantId notes').lean();
    if (!sourceJob) throw fail('Job not found', 'NOT_FOUND');
    if (!queryText) queryText = worksheetFingerprintText(sourceJob.notes);
  }

  if (!queryText) {
    return {
      compared: false,
      matches: [],
      message: 'This job has no worksheet note to compare.',
    };
  }

  let vector = null;
  if (excludeJobId) {
    const stored = await JobFingerprint.findOne({ jobId: excludeJobId }).select('text embedding').lean();
    if (stored && stored.text === queryText && Array.isArray(stored.embedding) && stored.embedding.length) {
      vector = stored.embedding;
    }
  }
  if (!vector) {
    vector = await embedText(queryText);
    if (sourceJob && worksheetFingerprintText(sourceJob.notes) === queryText) {
      try {
        await rememberFingerprint(sourceJob, queryText, vector);
      } catch (error) {
        console.error('Job fingerprint save failed:', error?.message || error);
      }
    }
  }

  const rows = await JobFingerprint.find({}).select('jobId text embedding').lean();
  const ranked = rankFingerprints(vector, rows, { excludeJobId, limit });
  if (!ranked.length) return { compared: true, matches: [] };

  const jobs = await Job.find({ _id: { $in: ranked.map((row) => row.jobId) } })
    .select('title stage customerId')
    .populate('customerId', 'name')
    .lean();
  const byId = new Map(jobs.map((job) => [String(job._id), job]));

  const matches = ranked
    .map((row) => {
      const job = byId.get(String(row.jobId));
      if (!job) return null;
      const customer = job.customerId;
      return {
        jobId: String(job._id),
        title: job.title || 'Untitled job',
        customerName: customer && typeof customer === 'object' ? customer.name || '' : '',
        stage: job.stage || '',
        stageLabel: STAGE_LABELS[job.stage] || job.stage || '',
        snippet: noteSnippet(row.text),
        score: Math.round(row.score * 100) / 100,
      };
    })
    .filter(Boolean);

  return { compared: true, matches };
}

module.exports = {
  embeddingConfigured,
  embedText,
  embedTexts,
  refreshJobFingerprint,
  scheduleJobFingerprint,
  removeJobFingerprint,
  searchSimilarJobs,
};
