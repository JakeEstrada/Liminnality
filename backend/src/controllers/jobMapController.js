const Job = require('../models/Job');
const Appointment = require('../models/Appointment');
const {
  formatJobLocation,
  inOrangeCounty,
  geocodeAddress,
  shouldRetryGeo,
} = require('../services/geocodeService');

/** Estimate / sales funnel — not shown on the map. */
const ESTIMATE_STAGES = [
  'APPOINTMENT_SCHEDULED',
  'ESTIMATE_IN_PROGRESS',
  'ESTIMATE_SENT',
  'ENGAGED_DESIGN_REVIEW',
  'CONTRACT_OUT',
];

/** Contracted work still on the kanban: job-readiness + execution. */
const PIPELINE_BOARD_STAGES = [
  'DEPOSIT_PENDING',
  'JOB_PREP',
  'TAKEOFF_COMPLETE',
  'READY_TO_SCHEDULE',
  'SCHEDULED',
  'IN_PRODUCTION',
  'INSTALLED',
  'FINAL_PAYMENT_CLOSED',
  'CONTRACT_SIGNED',
];

const SCHEDULED_STAGES = [
  'SCHEDULED',
  'IN_PRODUCTION',
  'INSTALLED',
  'FINAL_PAYMENT_CLOSED',
];

const CURRENT_STAGES = ['SCHEDULED', 'IN_PRODUCTION'];
const GEOCODE_BATCH = 8;

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function weekWindow(now = new Date()) {
  const today = startOfLocalDay(now);
  const weekStart = addDays(today, -today.getDay());
  const weekEnd = addDays(weekStart, 7);
  return { today, weekStart, weekEnd };
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jobWindows(job) {
  const windows = [];
  const schedule = job?.schedule || {};
  const entries = Array.isArray(schedule.entries) ? schedule.entries : [];
  if (entries.length) {
    for (const entry of entries) {
      const start = asDate(entry.startDate);
      if (!start) continue;
      windows.push({ start, end: asDate(entry.endDate) || start });
    }
    return windows;
  }
  const start = asDate(schedule.startDate);
  if (start) windows.push({ start, end: asDate(schedule.endDate) || start });
  return windows;
}

function overlaps(start, end, from, to) {
  return start < to && end >= from;
}

function isCurrentJob(job, today, tomorrow) {
  if (CURRENT_STAGES.includes(job.stage)) {
    const windows = jobWindows(job);
    if (!windows.length) return job.stage === 'IN_PRODUCTION';
    return windows.some((window) => overlaps(window.start, window.end, today, tomorrow));
  }
  return jobWindows(job).some((window) => overlaps(window.start, window.end, today, tomorrow));
}

function isThisWeekJob(job, weekStart, weekEnd, weekJobIds) {
  if (weekJobIds.has(String(job._id))) return true;
  return jobWindows(job).some((window) => overlaps(window.start, window.end, weekStart, weekEnd));
}

function isCompletedJob(job) {
  return (
    Boolean(job.isCompletedClosedOut) ||
    job.stage === 'INSTALLED' ||
    job.stage === 'FINAL_PAYMENT_CLOSED'
  );
}

function isArchivedLike(job) {
  return Boolean(job.isArchived) || Boolean(job.isDeadEstimate);
}

function isEstimateJob(job) {
  return ESTIMATE_STAGES.includes(job.stage);
}

function isContractedJob(job) {
  if (isEstimateJob(job)) return false;
  return PIPELINE_BOARD_STAGES.includes(job.stage) || isCompletedJob(job);
}

function isPipelineBoardJob(job) {
  if (isArchivedLike(job) || Boolean(job.isCompletedClosedOut)) return false;
  return PIPELINE_BOARD_STAGES.includes(job.stage);
}

function isScheduledJob(job) {
  return SCHEDULED_STAGES.includes(job.stage) || isCompletedJob(job);
}

function pinGroup(job) {
  if (isArchivedLike(job)) return 'archived';
  if (isScheduledJob(job)) return 'scheduled';
  return 'unscheduled';
}

function jobCity(job) {
  const fromJob = String(job.jobAddress?.city || '').trim();
  if (fromJob) return fromJob;
  const customer = job.customerId && typeof job.customerId === 'object' ? job.customerId : null;
  return String(customer?.address?.city || customer?.addresses?.[0]?.city || '').trim();
}

function jobAmount(job) {
  const contracted = Number(job.valueContracted);
  if (Number.isFinite(contracted) && contracted > 0) return contracted;
  const estimated = Number(job.valueEstimated);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  return 0;
}

function pinPayload(job, address, lat, lng) {
  const customer =
    job.customerId && typeof job.customerId === 'object' ? job.customerId : null;
  return {
    id: String(job._id),
    title: String(job.title || 'Untitled job'),
    stage: String(job.stage || ''),
    customerName: String(customer?.name || '').trim(),
    city: jobCity(job),
    amount: jobAmount(job),
    address,
    lat,
    lng,
    group: pinGroup(job),
    scheduled: isScheduledJob(job),
    isArchived: Boolean(job.isArchived),
    isDeadEstimate: Boolean(job.isDeadEstimate),
    isCompletedClosedOut: Boolean(job.isCompletedClosedOut),
  };
}

async function fillMissingCoords(jobs) {
  const pending = jobs.filter((job) => {
    const address = formatJobLocation(job);
    return address && shouldRetryGeo(job, address);
  });
  const batch = pending.slice(0, GEOCODE_BATCH);
  await Promise.all(
    batch.map(async (job) => {
      const address = formatJobLocation(job);
      const hit = await geocodeAddress(address);
      job.geo = {
        lat: hit?.lat,
        lng: hit?.lng,
        sourceAddress: address,
        geocodedAt: new Date(),
        status: hit ? 'ok' : 'failed',
      };
      try {
        await Job.updateOne(
          { _id: job._id },
          {
            $set: {
              geo: job.geo,
            },
          },
        );
      } catch {
        /* keep in-memory coords even if save fails */
      }
    }),
  );
}

function pinsInCounty(jobs) {
  return jobs
    .map((job) => {
      const address = formatJobLocation(job);
      const lat = Number(job.geo?.lat);
      const lng = Number(job.geo?.lng);
      if (!address || job.geo?.status !== 'ok' || !inOrangeCounty(lat, lng)) return null;
      return pinPayload(job, address, lat, lng);
    })
    .filter(Boolean);
}

async function getJobMapPins(req, res) {
  try {
    const { today, weekStart, weekEnd } = weekWindow();
    const tomorrow = addDays(today, 1);

    const jobs = await Job.find({})
      .select(
        'title stage jobAddress geo schedule customerId valueContracted valueEstimated isArchived isDeadEstimate isCompletedClosedOut',
      )
      .populate({ path: 'customerId', select: 'name address addresses', strictPopulate: false });

    const weekAppointments = await Appointment.find({
      status: 'scheduled',
      jobId: { $ne: null },
      date: { $gte: weekStart, $lt: weekEnd },
    })
      .select('jobId')
      .lean();
    const weekJobIds = new Set(weekAppointments.map((row) => String(row.jobId)));

    await fillMissingCoords(jobs);

    const liveJobs = jobs.filter((job) => isPipelineBoardJob(job));
    const pipelineJobs = liveJobs;
    const currentJobs = liveJobs.filter((job) => isCurrentJob(job, today, tomorrow));
    const weekJobs = liveJobs.filter((job) => isThisWeekJob(job, weekStart, weekEnd, weekJobIds));
    const completedJobs = jobs.filter((job) => !job.isDeadEstimate && isCompletedJob(job));
    const archivedJobs = jobs.filter((job) => isArchivedLike(job) && !isCompletedJob(job));

    return res.json({
      county: 'Orange County, CA',
      all: pinsInCounty(liveJobs),
      pipeline: pinsInCounty(pipelineJobs),
      current: pinsInCounty(currentJobs),
      week: pinsInCounty(weekJobs),
      completed: pinsInCounty(completedJobs),
      archived: pinsInCounty(archivedJobs),
    });
  } catch (error) {
    console.error('Failed to load job map pins:', error);
    return res.status(500).json({ error: 'Failed to load job map' });
  }
}

async function getJobGeoIssues(req, res) {
  try {
    const jobs = await Job.find({})
      .select('title stage jobAddress geo customerId isArchived isDeadEstimate')
      .populate({ path: 'customerId', select: 'name address addresses', strictPopulate: false })
      .sort({ updatedAt: -1 });

    const issues = jobs
      .map((job) => {
        const address = formatJobLocation(job);
        const lat = Number(job.geo?.lat);
        const lng = Number(job.geo?.lng);
        const mapped = job.geo?.status === 'ok' && Number.isFinite(lat) && Number.isFinite(lng);
        if (mapped) return null;
        const customer =
          job.customerId && typeof job.customerId === 'object' ? job.customerId : null;
        let reason = 'Could not convert address';
        if (!address) reason = 'No address on job or customer';
        else if (!/\d/.test(address)) reason = 'Address has no street number';
        else if (job.geo?.status === 'failed') reason = 'Geocoder could not match this address';
        return {
          id: String(job._id),
          title: String(job.title || 'Untitled job'),
          stage: String(job.stage || ''),
          customerName: String(customer?.name || '').trim(),
          address,
          reason,
          isArchived: Boolean(job.isArchived),
          isDeadEstimate: Boolean(job.isDeadEstimate),
        };
      })
      .filter(Boolean);

    return res.json({ count: issues.length, jobs: issues });
  } catch (error) {
    console.error('Failed to load geocode issues:', error);
    return res.status(500).json({ error: 'Failed to load jobs missing map points' });
  }
}

module.exports = { getJobMapPins, getJobGeoIssues };
