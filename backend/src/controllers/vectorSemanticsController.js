require('../models/Customer');
const Job = require('../models/Job');
const JobMemory = require('../models/JobMemory');
const {
  selectExampleRow,
  listJobsWithVectors,
  describeJobList,
  nearestOtherJobs,
  otherLinesOnJob,
  describeExample,
  describeLine,
  buildVectorDetail,
  answerVectorQuestion,
  rankJobPopularity,
  describePopularity,
} = require('../utils/vectorSemantics');
const { exactTokens, searchStems, textHasStems, textHasExactTokens, rankExactMatches, recencyYmd } = require('../utils/jobMemoryQuery');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const CACHE_MS = 10 * 60 * 1000;
const lineCache = new Map();
const popularityCache = new Map();

function embeddingModel() {
  return (process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small').trim() || 'text-embedding-3-small';
}

function openaiKey() {
  return process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENNAI_API_KEY || '';
}

async function loadLines(tenantId) {
  const key = String(tenantId || '');
  const hit = lineCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const rows = await JobMemory.find({})
    .select('jobId kind text embedding')
    .lean();
  const usable = rows.filter((row) => Array.isArray(row.embedding) && row.embedding.length > 8);
  lineCache.set(key, { at: Date.now(), rows: usable });
  return usable;
}

async function loadJobLabels(ids) {
  const unique = [...new Set(ids.map((id) => String(id || '')).filter(Boolean))];
  if (!unique.length) return new Map();
  const jobs = await Job.find({ _id: { $in: unique } })
    .populate('customerId', 'name')
    .select('title customerId')
    .lean();
  return new Map(jobs.map((job) => [String(job._id), {
    jobTitle: job.title || 'Untitled',
    customerName: job.customerId?.name || null,
  }]));
}

function rankedPopularity(tenantId, lines) {
  const key = String(tenantId || '');
  const hit = popularityCache.get(key);
  if (hit && hit.lines === lines) return hit.ranked;
  const ranked = rankJobPopularity(lines);
  popularityCache.set(key, { lines, ranked });
  return ranked;
}

function speakablePopularity(report, side) {
  const picked = side === 'most' || side === 'least' ? side : 'both';
  const say = picked === 'least'
    ? report.least.say
    : picked === 'most'
      ? report.most.say
      : [report.most.say, report.least.say].filter(Boolean).join(' ');
  const jobName = (job) => ({
    customerName: job.customerName,
    jobTitle: job.jobTitle,
    closeJobs: job.neighborCount,
  });
  return {
    jobCount: report.jobCount,
    say,
    hint: 'Higher density is more popular: more jobs point the same way. Speak the say line. Name customers, not job ids. A score is how near the nearest other job points, and only say a score if they ask how close.',
    most: picked === 'least' ? undefined : {
      count: report.most.count,
      shared: report.most.shared,
      say: report.most.say,
      jobs: (report.most.jobs || []).slice(0, 8).map(jobName),
    },
    least: picked === 'most' ? undefined : {
      say: report.least.say,
      jobs: (report.least.jobs || []).map((job) => ({
        customerName: job.customerName,
        jobTitle: job.jobTitle,
        nearest: job.nearestTitle,
        score: job.score,
      })),
    },
  };
}

async function readJobPopularity(tenantId, side) {
  const lines = await loadLines(tenantId);
  const ranked = rankedPopularity(tenantId, lines);
  const ids = [
    ...(ranked.mostJobIds || []),
    ...(ranked.least || []).flatMap((job) => [job.jobId, job.nearestJobId]),
  ];
  const labels = await loadJobLabels(ids);
  return speakablePopularity(describePopularity(ranked, labels), side);
}

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const message of messages.slice(-6)) {
    const role = message?.role === 'assistant' || message?.role === 'user' ? message.role : null;
    const content = typeof message?.content === 'string' ? message.content.trim().slice(0, 500) : '';
    if (!role || !content) continue;
    out.push({ role, content });
  }
  return out;
}

async function explainWithModel({ example, neighbors, sameJob, question, history }) {
  const key = openaiKey();
  if (!key) return '';
  const near = (neighbors || [])
    .map((line) => `${line.jobTitle} (${line.score}): ${line.excerpt}`)
    .join('\n');
  const also = (sameJob || [])
    .map((line) => `${line.kindLabel}: ${line.excerpt}`)
    .join('\n');
  const system = [
    'You explain one stored job vector to the person who runs this shop. Plain sentences. No markdown headings.',
    `The model is ${embeddingModel()}. A vector is ${example.dimensions} numbers for one whole line. A number is not a word and not a serial number. The job id identifies the job.`,
    'Closeness is cosine similarity. 1 is the same direction. Note search keeps a loose match from about 0.38 up. Similar jobs on the pipeline is a different vector, one worksheet note per job, and starts around 0.45.',
    'The numbers do not follow “instead of” or “not”. A date is stored separately. Last week is the previous shop week, Friday through Thursday, and that filter uses notes and tasks.',
    `Line on screen: ${example.jobTitle} (${example.kindLabel}): ${example.excerpt}`,
    `Preview: ${example.previewText}`,
    `Job id: ${example.jobId}`,
    near ? `Closest other jobs:\n${near}` : 'No other job was close.',
    also ? `Other lines on this same job:\n${also}` : '',
    'Answer from these lines. If the lines do not show a reason, say the score is only how near the lists point, and name the score. Do not invent jobs. Two or three short paragraphs.',
  ].filter(Boolean).join('\n');
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: question },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text || 'OpenAI request failed');
    error.status = response.status;
    throw error;
  }
  const data = JSON.parse(text);
  return String(data.choices?.[0]?.message?.content || '').trim().slice(0, 1200);
}

async function getVectorSemantics(req, res) {
  try {
    const query = String(req.query.q || '').trim().slice(0, 120);
    const jobId = String(req.query.jobId || '').trim();
    const memoryId = String(req.query.memoryId || '').trim();
    const lines = await loadLines(req.user?.tenantId);
    const model = embeddingModel();
    let catalog = listJobsWithVectors(lines);
    let order = 'name';
    if (!lines.length) {
      return res.json({
        empty: true,
        model,
        storedLines: 0,
        jobCount: 0,
        jobs: [],
        example: null,
        neighbors: [],
        sameJob: [],
        detail: ['No line has a vector yet. After notes are stored and embedded, a job will show up here as a list of numbers.'],
      });
    }
    const termTokens = exactTokens(query);
    const termStems = searchStems(query).filter((stem) => !termTokens.includes(stem));
    const termSearch = Boolean(query) && (termTokens.length > 0 || termStems.length > 0);
    let lineRank = new Map();
    if (termSearch) {
      const ranked = rankExactMatches(lines, query, { limit: 100 }) || [];
      lineRank = new Map(ranked.map((hit, index) => [String(hit.row.jobId), {
        index,
        memoryId: String(hit.row._id),
        noteDate: recencyYmd(hit.row),
      }]));
    }
    const selectedJob = jobId;
    const selectedMemory = memoryId;
    const labels = await loadJobLabels(catalog.map((entry) => entry.jobId));
    let jobs = describeJobList(catalog, labels);
    if (termSearch) {
      const lineJobs = [];
      const titleJobs = [];
      for (const job of jobs) {
        const hit = lineRank.get(job.jobId);
        const title = `${job.jobTitle || ''} ${job.customerName || ''}`;
        const titleHit = (!termTokens.length || textHasExactTokens(title, termTokens))
          && (!termStems.length || textHasStems(title, termStems));
        if (hit) lineJobs.push({ ...job, memoryId: hit.memoryId, noteDate: hit.noteDate });
        else if (titleHit) titleJobs.push(job);
      }
      lineJobs.sort((a, b) => lineRank.get(a.jobId).index - lineRank.get(b.jobId).index);
      jobs = [...lineJobs, ...titleJobs];
      order = lineJobs.length ? 'recent' : 'terms';
    }
    const picked = (order === 'recent' || order === 'terms')
      ? (jobs.some((job) => job.jobId === selectedJob) ? selectedJob : (jobs[0]?.jobId || ''))
      : selectedJob;
    const pickedMemory = (order === 'recent' || order === 'terms')
      ? (jobs.find((job) => job.jobId === picked)?.memoryId || '')
      : selectedMemory;
    const exampleRow = (order === 'recent' || order === 'terms')
      ? (picked ? selectExampleRow(lines, { jobId: picked, memoryId: pickedMemory }) : null)
      : selectExampleRow(lines, { jobId: selectedJob, memoryId: selectedMemory });
    const neighborHits = exampleRow ? nearestOtherJobs(exampleRow, lines, 5) : [];
    const sameHits = exampleRow ? otherLinesOnJob(exampleRow, lines, 4) : [];
    const extraLabels = await loadJobLabels(neighborHits.map((hit) => hit.row.jobId));
    for (const [id, value] of extraLabels) labels.set(id, value);
    const example = exampleRow ? describeExample(exampleRow, labels) : null;
    const neighbors = neighborHits.map((hit) => describeLine(hit.row, labels, hit.score));
    const sameJob = sameHits.map((hit) => describeLine(hit.row, labels, hit.score));
    const popularity = describePopularity(rankedPopularity(req.user?.tenantId, lines), labels);
    return res.json({
      empty: !example,
      model,
      storedLines: lines.length,
      jobCount: jobs.length,
      order,
      jobs,
      example,
      neighbors,
      sameJob,
      popularity,
      detail: example
        ? buildVectorDetail(example, neighbors, sameJob, { model, storedLines: lines.length })
        : [termSearch
          ? 'No stored line has those words.'
          : 'No stored line matched that job.'],
    });
  } catch (error) {
    console.error('getVectorSemantics:', error.message || error);
    return res.status(500).json({ error: 'Could not read the stored vectors.' });
  }
}

async function askVectorSemantics(req, res) {
  try {
    const memoryId = String(req.body?.memoryId || '').trim();
    const question = String(req.body?.question || '').trim().slice(0, 500);
    if (!memoryId || !question) {
      return res.status(400).json({ error: 'Ask about the vector on the page.' });
    }
    const lines = await loadLines(req.user?.tenantId);
    const row = lines.find((line) => String(line._id) === memoryId);
    if (!row) {
      return res.status(404).json({ error: 'That line is not in the stored vectors. Show it again.' });
    }
    const neighborHits = nearestOtherJobs(row, lines, 5);
    const sameHits = otherLinesOnJob(row, lines, 4);
    const labels = await loadJobLabels([
      row.jobId,
      ...neighborHits.map((hit) => hit.row.jobId),
    ]);
    const example = describeExample(row, labels);
    const neighbors = neighborHits.map((hit) => describeLine(hit.row, labels, hit.score));
    const sameJob = sameHits.map((hit) => describeLine(hit.row, labels, hit.score));
    const history = sanitizeHistory(req.body?.messages);
    let reply = '';
    try {
      reply = await explainWithModel({ example, neighbors, sameJob, question, history });
    } catch (error) {
      console.error('askVectorSemantics model:', error.message || error);
    }
    if (!reply) reply = answerVectorQuestion(question, example, neighbors);
    return res.json({ reply });
  } catch (error) {
    console.error('askVectorSemantics:', error.message || error);
    return res.status(500).json({ error: 'Could not answer from the stored vectors.' });
  }
}

module.exports = {
  getVectorSemantics,
  askVectorSemantics,
  readJobPopularity,
};
