/* eslint-disable no-console */
/**
 * Copy existing notes, worksheet scrapes, crew notes, and job tasks into job memory.
 * Run from the Paarth folder: npm run backfill-job-memory
 * Safe to run again. Does not call OpenAI.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Job = require('../models/Job');
const Task = require('../models/Task');
const { refreshJobMemory, refreshTaskMemory } = require('../services/jobMemory');

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is missing');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const JobMemory = require('../models/JobMemory');
  await JobMemory.init();
  const jobs = await Job.find().select('title tenantId notes schedule updatedAt');
  let jobRows = 0;
  for (const job of jobs) {
    const result = await refreshJobMemory(job);
    jobRows += result.saved;
  }
  const tasks = await Task.find({ jobId: { $ne: null } });
  let taskRows = 0;
  for (const task of tasks) {
    const result = await refreshTaskMemory(task);
    taskRows += result.saved;
  }
  console.log(`Job memory: ${jobRows} note rows from ${jobs.length} jobs, ${taskRows} tasks.`);
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
