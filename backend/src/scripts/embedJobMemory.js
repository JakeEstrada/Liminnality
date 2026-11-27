/* eslint-disable no-console */
/**
 * Build a vector for each stored note, task, and worksheet line that does not have one yet.
 * Run from the Paarth folder: npm run embed-job-memory
 * Safe to run again. Uses the OpenAI embedding key.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { embeddingConfigured } = require('../services/jobFingerprint');
const { embedMissingMemory } = require('../services/jobMemory');

function outOfCredits(error) {
  return /insufficient_quota|credit_balance|no credits remaining|exceeded your current quota/i.test(
    String(error?.message || ''),
  );
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
  try {
    const result = await embedMissingMemory((done, total) => {
      console.log(`Vectors ${done} of ${total}`);
    });
    console.log(`Job memory vectors: ${result.embedded} saved of ${result.pending}.`);
  } catch (error) {
    if (outOfCredits(error)) {
      console.error('Stopped: the OpenAI account is out of credits. Vectors already saved stay saved.');
    } else {
      console.error(error.message || error);
    }
    process.exitCode = 1;
  }
  await mongoose.disconnect();
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
