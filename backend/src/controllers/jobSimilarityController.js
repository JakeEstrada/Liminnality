const mongoose = require('mongoose');
const { searchSimilarJobs } = require('../services/jobFingerprint');

async function findSimilarJobs(req, res) {
  try {
    const jobId = String(req.body?.jobId || '').trim();
    const text = String(req.body?.text || '').trim().slice(0, 8000);
    if (jobId && !mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'That job id is not valid' });
    }
    if (!jobId && text.length < 8) {
      return res.status(400).json({ error: 'Add a worksheet note, or open a job that has one' });
    }
    const result = await searchSimilarJobs({ jobId, text, limit: 5 });
    return res.json(result);
  } catch (error) {
    if (error.code === 'NOT_FOUND') return res.status(404).json({ error: 'Job not found' });
    if (error.code === 'OPENAI_API_KEY_NOT_SET') {
      return res.status(503).json({ error: 'Similar search needs an OpenAI key on the server' });
    }
    console.error('Similar jobs failed:', error.message);
    return res.status(500).json({ error: 'Could not search similar jobs' });
  }
}

module.exports = { findSimilarJobs };
