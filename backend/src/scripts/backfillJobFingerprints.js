/* eslint-disable no-console */
/**
 * One-time fill for jobs that already have a worksheet note.
 * Run from backend/: npm run backfill-job-fingerprints
 * Uses MONGODB_URI from the environment. Does not remove jobs that have no worksheet note.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Job = require('../models/Job');
const { embeddingConfigured, refreshJobFingerprint } = require('../services/jobFingerprint');
const { worksheetFingerprintText } = require('../utils/jobSimilarity');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is missing');
    process.exit(1);
  }
  if (!embeddingConfigured()) {
    console.error('OPENAI_API_KEY is missing');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const jobs = await Job.find({ 'notes.0': { $exists: true } }).select('title tenantId notes');

  let saved = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    if (!worksheetFingerprintText(job.notes)) {
      skipped += 1;
      continue;
    }
    try {
      const result = await refreshJobFingerprint(job);
      if (result === 'saved') saved += 1;
      else if (result === 'unchanged') unchanged += 1;
      else skipped += 1;
      await sleep(200);
    } catch (error) {
      failed += 1;
      console.error(`Fingerprint failed for "${job.title || job._id}": ${error.message}`);
    }
  }

  console.log(
    `Fingerprints: ${saved} saved, ${unchanged} already current, ${failed} failed, ${skipped} skipped (no worksheet note).`,
  );
  await mongoose.disconnect();
  if (failed) process.exitCode = 1;
}

run().catch(async (error) => {
  console.error(error.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
