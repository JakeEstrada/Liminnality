const mongoose = require('mongoose');
const Job = require('../models/Job');
const Activity = require('../models/Activity');
const Estimate = require('../models/Estimate');
const {
  emitJobCreated,
  emitJobUpdated,
  emitJobDeleted,
} = require('../services/jobRealtime');
const {
  roundMoney,
  getContractBase,
  resolvePaymentSchedule,
  normalizePaymentScheduleInput,
  findScheduleAmountForKind,
  diffPaymentScheduleActivities,
} = require('../utils/paymentSchedule');
const { notifyPaymentMarkedPaid } = require('../services/paymentNotificationService');
const { upsertPaymentReceivedActivity, voidPaymentReceivedActivity, reconcilePaymentReceivedActivities } = require('../services/paymentActivitySync');
const { applyReferralFields } = require('../utils/referralCompany');
const { resolveJobId } = require('../utils/resolveJobId');
const { syncJobGeo, parseManualGeo, manualGeoPayload } = require('../services/geocodeService');

/** Jobs manually restored from archive are exempt from auto-dead-estimate for this many days */
const RESTORE_FROM_ARCHIVE_GRACE_DAYS = 30;
const CUSTOMER_CONTACT_FIELDS = 'name primaryPhone primaryEmail emails contactEmails address contactPhones gateCode';

function parseTruthyQuery(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function normalizeStageForPipelineRestore(stage) {
  const { ALL_STAGES } = require('../utils/stageConfig');
  const valid = new Set(ALL_STAGES);
  if (!stage || stage === 'APPOINTMENT_SCHEDULED') return 'ESTIMATE_SENT';
  if (stage === 'CONTRACT_SIGNED') return 'DEPOSIT_PENDING';
  if (valid.has(stage)) return stage;
  return 'ESTIMATE_SENT';
}

function isWithinRestoreGracePeriod(job, nowMs = Date.now()) {
  if (!job?.restoredFromArchiveAt) return false;
  const restoredMs = new Date(job.restoredFromArchiveAt).getTime();
  if (Number.isNaN(restoredMs)) return false;
  return nowMs - restoredMs < RESTORE_FROM_ARCHIVE_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

function warnLegacyEstimateUsage(context, details = {}) {
  console.warn('[estimate-deprecated]', context, details);
}

async function getLatestEstimateMapByJobIds(jobIds = []) {
  const ids = Array.from(new Set(jobIds.map((id) => String(id || '')).filter(Boolean)));
  if (!ids.length) return new Map();
  const estimates = await Estimate.find(
    { jobId: { $in: ids } },
    '_id jobId status sentAt estimateNumber projectName createdAt updatedAt'
  )
    .sort({ createdAt: -1 })
    .lean();
  const map = new Map();
  for (const est of estimates) {
    const k = String(est.jobId || '');
    if (!k || map.has(k)) continue;
    map.set(k, est);
  }
  return map;
}

// Get all jobs
async function getJobs(req, res) {
  try {
    const {
      stage,
      assignedTo,
      search,
      customerId,
      page = 1,
      limit = 100,
      includeCompletedClosedOut,
      includeArchived,
      includeDeadEstimates,
    } = req.query;
    const includeClosedOut = parseTruthyQuery(includeCompletedClosedOut);
    const includeArchivedJobs = parseTruthyQuery(includeArchived);
    const includeDeadEstimateJobs = parseTruthyQuery(includeDeadEstimates);
    
    let query = {};
    if (!includeArchivedJobs) {
      query.isArchived = { $ne: true }; // Matches false, null, or missing field
    }
    if (!includeDeadEstimateJobs) {
      query.isDeadEstimate = { $ne: true }; // Matches false, null, or missing field
    }
    if (!includeClosedOut) {
      query.isCompletedClosedOut = { $ne: true }; // Keep closed-out completed jobs off active pipeline by default
    }
    
    if (stage) query.stage = stage;
    if (assignedTo) query.assignedTo = assignedTo;
    if (customerId) query.customerId = customerId;
    if (search) query.title = { $regex: search, $options: 'i' };
    
    const jobs = await Job.find(query)
      .populate({
        path: 'customerId',
        select: 'name primaryPhone primaryEmail address phones contactPhones',
        strictPopulate: false
      })
      .populate({
        path: 'assignedTo',
        select: 'name email',
        strictPopulate: false
      })
      .populate({
        path: 'createdBy',
        select: 'name email',
        strictPopulate: false
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Job.countDocuments(query);
    
    res.json({
      jobs,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get single job
async function getJob(req, res) {
  try {
    const id = resolveJobId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const job = await Job.findById(id)
      .populate('customerId')
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('notes.createdBy', 'name email');
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const jobObj = job.toObject();
    const resolved = resolvePaymentSchedule(jobObj);
    jobObj.paymentScheduleResolved = resolved;
    
    res.json(jobObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Create job
async function createJob(req, res) {
  try {
    const User = require('../models/User');
    
    // Handle createdBy - use req.user if available, otherwise get default user
    let createdBy = req.user?._id || req.body.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      } else {
        return res.status(400).json({ error: 'No user available. Please ensure at least one user exists in the system.' });
      }
    }
    
    // Ensure stage is set to ESTIMATE_IN_PROGRESS if not provided
    const jobData = applyReferralFields({
      ...req.body,
      stage: req.body.stage || 'ESTIMATE_IN_PROGRESS',
      createdBy: createdBy
    });
    
    const job = new Job(jobData);
    await job.save();
    
    // Log activity
    await Activity.create({
      type: 'job_created',
      jobId: job._id,
      customerId: job.customerId,
      note: `Job "${job.title}" created in stage ${job.stage}`,
      createdBy: createdBy
    });
    
    await job.populate('customerId', CUSTOMER_CONTACT_FIELDS);
    await job.populate('assignedTo', 'name email');
    void syncJobGeo(job).catch(() => {});

    await emitJobCreated(req, job);
    
    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Helper function to deep compare and track changes
function trackChanges(oldData, newData, prefix = '') {
  const changes = {};
  const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
  
  // Fields to exclude from tracking (internal/metadata fields)
  const excludeFields = ['_id', '__v', 'createdAt', 'updatedAt', 'notes'];
  
  for (const key of allKeys) {
    if (excludeFields.includes(key)) continue;
    
    const oldValue = oldData?.[key];
    const newValue = newData?.[key];
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    
    // Handle nested objects (but not arrays, dates, or ObjectIds)
    if (newValue && typeof newValue === 'object' && 
        !Array.isArray(newValue) && 
        !(newValue instanceof Date) && 
        !(newValue instanceof mongoose.Types.ObjectId) &&
        newValue.constructor === Object) {
      const nestedChanges = trackChanges(oldValue || {}, newValue, fieldPath);
      Object.assign(changes, nestedChanges);
    } else {
      // Compare values
      const oldStr = JSON.stringify(oldValue);
      const newStr = JSON.stringify(newValue);
      
      if (oldStr !== newStr) {
        changes[fieldPath] = { from: oldValue, to: newValue };
      }
    }
  }
  
  return changes;
}

// Update job
async function updateJob(req, res) {
  try {
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const oldData = job.toObject();
    const oldNotesCount = job.notes ? job.notes.length : 0;
    const oldStage = job.stage;
    
    // Handle notes separately - check if new notes are being added
    const newNotes = req.body.notes;
    const notesToAdd = [];
    const User = require('../models/User');
    
    // Handle createdBy for new notes.
    // Prefer authenticated user; if auth is unavailable, accept explicit actor from request.
    let createdBy = req.user?._id || req.body.createdBy || job.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      }
    }
    let createdByName = req.user?.name || req.body.createdByName || null;
    if (!createdByName && createdBy) {
      const creatorUser = await User.findById(createdBy).select('name');
      createdByName = creatorUser?.name || null;
    }
    
    if (newNotes && Array.isArray(newNotes)) {
      // Find newly added notes (notes that weren't in the old array)
      const oldNoteIds = (oldData.notes || []).map(n => n._id?.toString()).filter(Boolean);
      const oldNotesMap = new Map();
      (oldData.notes || []).forEach(note => {
        if (note._id) {
          oldNotesMap.set(note._id.toString(), note);
        }
      });
      
      const notesToUpdate = [];
      const updatedNotes = newNotes.map(note => {
        // If it's a new note (no _id or _id not in old array), set createdBy and createdAt
        if (!note._id || !oldNoteIds.includes(note._id?.toString())) {
          if (note.content) {
            notesToAdd.push(note.content);
            return {
              content: note.content,
              createdBy: createdBy,
              createdByName: createdByName,
              createdAt: note.createdAt || new Date(),
              isStageChange: note.isStageChange || false,
              isAppointment: note.isAppointment || false,
              important: Boolean(note.important),
            };
          }
        } else {
          // Existing note - check if content was updated
          const oldNote = oldNotesMap.get(note._id.toString());
          if (oldNote && oldNote.content !== note.content && note.content) {
            notesToUpdate.push({
              oldContent: oldNote.content,
              newContent: note.content
            });
          }
        }
        // Return note (either new or existing)
        return note;
      });
      
      // Replace notes array with updated one
      req.body.notes = updatedNotes;
      
      // Store notesToUpdate for activity logging
      req.body._notesToUpdate = notesToUpdate;
    }
    
    // Store notesToUpdate before updating job (since Object.assign will include it)
    const notesToUpdate = req.body._notesToUpdate || [];
    
    // Update the job (remove temporary _notesToUpdate field first)
    const { _notesToUpdate, ...jobUpdateData } = req.body;
    delete jobUpdateData.invoices;
    delete jobUpdateData.paymentScheduleResolved;

    let paymentScheduleWarnings = [];
    let paymentScheduleActivities = [];
    if (jobUpdateData.paymentSchedule !== undefined) {
      const contractBase = getContractBase({ ...job.toObject(), ...jobUpdateData });
      const { schedule, warnings } = normalizePaymentScheduleInput(
        jobUpdateData.paymentSchedule,
        contractBase
      );
      paymentScheduleWarnings = warnings;
      paymentScheduleActivities = diffPaymentScheduleActivities(
        oldData.paymentSchedule,
        schedule
      );
      jobUpdateData.paymentSchedule = schedule;
    }
    if (jobUpdateData.estimateHistory !== undefined || jobUpdateData.estimate !== undefined) {
      warnLegacyEstimateUsage('updateJob ignored legacy estimate payload', {
        jobId: String(job._id),
        hasEstimate: jobUpdateData.estimate !== undefined,
        hasEstimateHistory: jobUpdateData.estimateHistory !== undefined,
      });
    }
    delete jobUpdateData.estimateHistory;
    delete jobUpdateData.estimate;
    applyReferralFields(jobUpdateData);
    const manualCoords = parseManualGeo(jobUpdateData.geo);
    if (manualCoords) {
      jobUpdateData.geo = manualGeoPayload(
        { ...job.toObject(), ...jobUpdateData },
        manualCoords.lat,
        manualCoords.lng,
      );
    } else {
      delete jobUpdateData.geo;
    }
    Object.assign(job, jobUpdateData);
    if (jobUpdateData.takeoff !== undefined) {
      job.markModified('takeoff');
    }
    if (jobUpdateData.paymentSchedule !== undefined) {
      job.markModified('paymentSchedule');
    }
    if (jobUpdateData.changeOrders !== undefined) {
      job.markModified('changeOrders');
    }
    if (jobUpdateData.commissionLog !== undefined) {
      job.markModified('commissionLog');
    }
    await job.save();
    if (!manualCoords) void syncJobGeo(job).catch(() => {});

    const pendingPaymentNotifications = [];
    for (const activity of paymentScheduleActivities) {
      try {
        if (activity.type === 'payment_received_void') {
          await voidPaymentReceivedActivity({
            jobId: job._id,
            scheduleLabel: activity.scheduleLabel,
          });
          continue;
        }
        if (activity.type === 'payment_received_sync') {
          const { doc, created } = await upsertPaymentReceivedActivity({
            jobId: job._id,
            customerId: job.customerId,
            scheduleLabel: activity.scheduleLabel,
            note: activity.note,
            amount: activity.amount,
            paymentType: activity.paymentType,
            paymentPaidAt: activity.paymentPaidAt,
            createdBy: req.user?._id || job.createdBy || createdBy,
          });
          if (created && doc) {
            pendingPaymentNotifications.push({
              doc,
              scheduleLabel: activity.scheduleLabel,
            });
          }
          continue;
        }
        const doc = await Activity.create({
          type: activity.type,
          jobId: job._id,
          customerId: job.customerId,
          note: activity.note,
          amount: activity.amount,
          paymentType: activity.paymentType,
          paymentPaidAt: activity.paymentPaidAt || undefined,
          createdBy: req.user?._id || job.createdBy || createdBy,
        });
        if (activity.type === 'payment_received') {
          pendingPaymentNotifications.push({
            doc,
            scheduleLabel: activity.scheduleLabel,
          });
        }
      } catch (activityError) {
        console.error('Error creating payment schedule activity:', activityError);
      }
    }

    if (jobUpdateData.paymentSchedule !== undefined) {
      try {
        await reconcilePaymentReceivedActivities({
          job,
          schedule: job.paymentSchedule,
          createdBy: req.user?._id || job.createdBy || createdBy,
        });
      } catch (reconcileError) {
        console.error('Error reconciling payment_received activities:', reconcileError);
      }
    }

    if (pendingPaymentNotifications.length > 0) {
      const populatedJob = await Job.findById(job._id).populate('customerId', 'name');
      const tenantId = req.user?.tenantId || job.tenantId;
      for (const row of pendingPaymentNotifications) {
        notifyPaymentMarkedPaid({
          tenantId,
          job: populatedJob || job,
          paymentActivity: row.doc,
          activityId: row.doc._id,
          createdBy: req.user?._id || job.createdBy,
          scheduleLabel: row.scheduleLabel,
        });
      }
    }
    
    // Track ALL field changes (excluding notes which we handle separately)
    const changes = trackChanges(
      { ...oldData, notes: undefined },
      { ...job.toObject(), notes: undefined }
    );
    
    // Log stage changes separately (if stage changed)
    if (oldStage !== job.stage) {
      await Activity.create({
        type: 'stage_change',
        jobId: job._id,
        customerId: job.customerId,
        fromStage: oldStage,
        toStage: job.stage,
        note: `Stage changed from ${oldStage} to ${job.stage}`,
        createdBy: req.user?._id || job.createdBy
      });
    }
    
    // Log schedule updates separately (if schedule changed)
    const oldSchedule = oldData.schedule || {};
    const newSchedule = job.schedule || {};
    
    // Compare dates properly (handle Date objects and strings)
    const oldStartDate = oldSchedule.startDate ? new Date(oldSchedule.startDate).getTime() : null;
    const newStartDate = newSchedule.startDate ? new Date(newSchedule.startDate).getTime() : null;
    const oldEndDate = oldSchedule.endDate ? new Date(oldSchedule.endDate).getTime() : null;
    const newEndDate = newSchedule.endDate ? new Date(newSchedule.endDate).getTime() : null;
    
    const scheduleChanged = 
      (oldStartDate !== newStartDate) ||
      (oldEndDate !== newEndDate);
    
    if (scheduleChanged && (newSchedule.startDate || newSchedule.endDate)) {
      const scheduleNote = [];
      if (newSchedule.startDate) {
        scheduleNote.push(`Start: ${new Date(newSchedule.startDate).toLocaleDateString()}`);
      }
      if (newSchedule.endDate) {
        scheduleNote.push(`End: ${new Date(newSchedule.endDate).toLocaleDateString()}`);
      }
      
      try {
        await Activity.create({
          type: 'job_scheduled',
          jobId: job._id,
          customerId: job.customerId,
          note: `Schedule updated: ${scheduleNote.join(', ')}`,
          createdBy: req.user?._id || job.createdBy || createdBy
        });
      } catch (activityError) {
        console.error('Error creating schedule activity:', activityError);
      }
    }
    
    // Log notes being added
    for (const noteContent of notesToAdd) {
      await Activity.create({
        type: 'note',
        jobId: job._id,
        customerId: job.customerId,
        note: noteContent,
        createdBy: req.user?._id || job.createdBy
      });
    }
    
    // Log notes being updated
    for (const noteUpdate of notesToUpdate) {
      try {
        await Activity.create({
          type: 'note',
          jobId: job._id,
          customerId: job.customerId,
          note: `Note updated: ${noteUpdate.newContent}`,
          createdBy: req.user?._id || job.createdBy
        });
      } catch (activityError) {
        console.error('Error creating activity for note update:', activityError);
        // Don't fail the request if activity logging fails
      }
    }
    
    // Log other field changes (if any) - but exclude schedule since we handle it separately
    const changesWithoutSchedule = { ...changes };
    delete changesWithoutSchedule['schedule.startDate'];
    delete changesWithoutSchedule['schedule.endDate'];
    delete changesWithoutSchedule['schedule'];
    delete changesWithoutSchedule['paymentSchedule'];
    delete changesWithoutSchedule['paymentSchedule.type'];
    Object.keys(changesWithoutSchedule).forEach((key) => {
      if (key.startsWith('paymentSchedule.items')) {
        delete changesWithoutSchedule[key];
      }
    });
    
    if (Object.keys(changesWithoutSchedule).length > 0) {
      // Create a readable description of changes
      const changeDescriptions = Object.entries(changes).map(([field, change]) => {
        const fromValue = change.from !== undefined && change.from !== null ? String(change.from) : 'empty';
        const toValue = change.to !== undefined && change.to !== null ? String(change.to) : 'empty';
        return `${field}: ${fromValue} → ${toValue}`;
      });
      
      // Convert changes object to Map for Activity model
      // Also convert Date objects to ISO strings for storage
      const changesMap = new Map();
      Object.entries(changes).forEach(([key, value]) => {
        // Convert Date objects to ISO strings for storage
        const processedValue = {
          from: value.from instanceof Date ? value.from.toISOString() : value.from,
          to: value.to instanceof Date ? value.to.toISOString() : value.to
        };
        changesMap.set(key, processedValue);
      });
      
      try {
        await Activity.create({
          type: 'job_updated',
          jobId: job._id,
          customerId: job.customerId,
          changes: changesMap,
          note: `Job updated: ${changeDescriptions.join(', ')}`,
          createdBy: req.user?._id || job.createdBy
        });
      } catch (activityError) {
        // Log activity error but don't fail the job update
        console.error('Error creating activity log:', activityError);
        console.error('Activity error details:', activityError.message);
      }
    }
    
    await job.populate('customerId', CUSTOMER_CONTACT_FIELDS);
    await job.populate('assignedTo', 'name email');

    await emitJobUpdated(req, job);

    const responseJob = job.toObject();
    responseJob.paymentScheduleResolved = resolvePaymentSchedule(responseJob);
    if (paymentScheduleWarnings.length) {
      responseJob.paymentScheduleWarnings = paymentScheduleWarnings;
    }
    
    res.json(responseJob);
  } catch (error) {
    console.error('Error updating job:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: error.message, 
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
}

/** Append a deposit or final invoice derived from the job payment schedule (or 40/60 fallback). */
async function addJobInvoice(req, res) {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const kind = req.body?.kind;
    if (kind !== 'deposit' && kind !== 'final') {
      return res.status(400).json({ error: 'kind must be "deposit" or "final"' });
    }

    const contractTotal = Number(req.body?.contractTotal);
    if (!Number.isFinite(contractTotal) || contractTotal <= 0) {
      return res.status(400).json({ error: 'contractTotal must be a positive number' });
    }

    const estimateNumber = String(req.body?.estimateNumber || '').trim();
    if (!estimateNumber) {
      return res.status(400).json({ error: 'estimateNumber is required' });
    }

    const resolvedSchedule = resolvePaymentSchedule(job.toObject());
    let amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      const scheduleAmount = findScheduleAmountForKind(resolvedSchedule, kind);
      if (scheduleAmount != null && scheduleAmount > 0) {
        amount = scheduleAmount;
      } else {
        const pct = kind === 'deposit' ? 0.4 : 0.6;
        amount = roundMoney(contractTotal * pct);
      }
    } else {
      amount = roundMoney(amount);
    }

    const invoiceDate =
      String(req.body?.invoiceDate || '').trim() || new Date().toISOString().slice(0, 10);

    const scheduleItem =
      kind === 'deposit'
        ? resolvedSchedule.items.find((i) => i.dueType === 'deposit') ||
          resolvedSchedule.items.find((i) => /deposit/i.test(String(i.label || '')))
        : resolvedSchedule.items.find((i) => i.dueType === 'final') ||
          resolvedSchedule.items.find((i) => /final/i.test(String(i.label || '')));
    const pctPart =
      scheduleItem?.amountType === 'percentage' && Number.isFinite(Number(scheduleItem.percentage))
        ? ` (${scheduleItem.percentage}%)`
        : '';
    const label =
      kind === 'deposit'
        ? `Deposit invoice${pctPart}`
        : `Final invoice${pctPart}`;

    const entry = {
      kind,
      amount,
      estimateNumber,
      contractTotal: roundMoney(contractTotal),
      invoiceDate,
      label,
    };

    if (!Array.isArray(job.invoices)) {
      job.invoices = [];
    }
    job.invoices.push(entry);
    job.markModified('invoices');
    await job.save();
    await job.populate('customerId', CUSTOMER_CONTACT_FIELDS);
    await job.populate('assignedTo', 'name email');
    const pushed = job.invoices[job.invoices.length - 1];
    return res.status(201).json({ job, invoice: pushed });
  } catch (error) {
    console.error('Error adding job invoice:', error);
    return res.status(500).json({ error: error.message || 'Failed to create invoice' });
  }
}

// Move job to different stage
async function moveJobStage(req, res) {
  try {
    const { toStage, note } = req.body;
    
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const fromStage = job.stage;
    
    if (fromStage === toStage) {
      return res.status(400).json({ error: 'Job is already in this stage' });
    }
    
    job.stage = toStage;
    
    // ALWAYS log stage changes
    const User = require('../models/User');
    const { STAGE_LABELS } = require('../utils/stageConfig');
    let createdBy = req.user?._id || job.createdBy;
    if (!createdBy) {
      // Fallback to default active user if auth is disabled
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      }
    }
    
    // Add note to job's notes array with stage change information
    if (createdBy) {
      const fromStageLabel = STAGE_LABELS[fromStage] || fromStage;
      const toStageLabel = STAGE_LABELS[toStage] || toStage;
      const stageChangeNote = `Stage updated: ${fromStageLabel} → ${toStageLabel}`;
      
      job.notes.push({
        content: stageChangeNote,
        createdBy: createdBy,
        createdAt: new Date(),
        isStageChange: true // Mark as stage change note for frontend styling
      });
      
      await Activity.create({
        type: 'stage_change',
        jobId: job._id,
        customerId: job.customerId,
        fromStage,
        toStage,
        note: note || `Moved from ${fromStage} to ${toStage}`,
        createdBy: createdBy
      });
    }
    
    await job.save();
    
    await job.populate('customerId', CUSTOMER_CONTACT_FIELDS);
    await job.populate('assignedTo', 'name email');

    await emitJobUpdated(req, job);
    
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Delete job
async function deleteJob(req, res) {
  try {
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Log deletion before deleting
    await Activity.create({
      type: 'job_updated',
      jobId: job._id,
      customerId: job.customerId,
      note: `Job "${job.title}" deleted`,
      createdBy: req.user?._id || job.createdBy
    });
    
    await Job.findByIdAndDelete(req.params.id);

    await emitJobDeleted(req, job);

    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get pipeline summary (counts and totals per stage)
async function getPipelineSummary(req, res) {
  try {
    const stages = [
      'APPOINTMENT_SCHEDULED',
      'ESTIMATE_IN_PROGRESS',
      'ESTIMATE_SENT',
      'ENGAGED_DESIGN_REVIEW',
      'CONTRACT_OUT',
      'DEPOSIT_PENDING',
      'JOB_PREP',
      'TAKEOFF_COMPLETE',
      'READY_TO_SCHEDULE',
      'SCHEDULED',
      'IN_PRODUCTION',
      'INSTALLED',
      'FINAL_PAYMENT_CLOSED'
    ];
    
    const summary = await Promise.all(
      stages.map(async (stage) => {
        const jobs = await Job.find({ 
          stage, 
          isArchived: false,
          isDeadEstimate: { $ne: true }, // Matches false, null, or missing field
          isCompletedClosedOut: { $ne: true },
        });
        const count = jobs.length;
        const totalValue = jobs.reduce((sum, job) => sum + (job.valueEstimated || 0), 0);
        
        return { stage, count, totalValue };
      })
    );
    
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get archived jobs organized by month/year (dead estimates + manually archived non-completed jobs)
async function getArchivedJobs(req, res) {
  try {
    // Archive page is strictly for jobs that did NOT move forward (dead/cancelled paths),
    // not successfully completed jobs.
    const jobs = await Job.find({
      $or: [
        { isDeadEstimate: true },
        { isArchived: true, stage: { $ne: 'FINAL_PAYMENT_CLOSED' } }
      ]
    })
      .populate('customerId', CUSTOMER_CONTACT_FIELDS)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ archivedAt: -1, movedToDeadEstimateAt: -1, updatedAt: -1 });
    const estimateByJob = await getLatestEstimateMapByJobIds(jobs.map((j) => j._id));
    
    // Organize by month/year based on archive date or estimate sent date
    const organized = {};
    jobs.forEach(job => {
      // Priority: archivedAt (for manually archived) > estimate.sentAt > movedToDeadEstimateAt > createdAt
      const estimateDoc = estimateByJob.get(String(job._id)) || null;
      const archiveDate = job.archivedAt
        ? job.archivedAt
        : (estimateDoc?.sentAt
          ? estimateDoc.sentAt
          : (job.movedToDeadEstimateAt
            ? job.movedToDeadEstimateAt
            : job.createdAt));
      
      if (!archiveDate) return;
      
      const date = new Date(archiveDate);
      const year = date.getFullYear();
      const month = date.getMonth(); // 0-11
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleString('default', { month: 'long' });
      
      if (!organized[key]) {
        organized[key] = {
          year,
          month: month + 1,
          monthName,
          jobs: []
        };
      }
      
      const enriched = job.toObject ? job.toObject() : job;
      enriched.estimateMeta = estimateDoc
        ? {
            estimateId: estimateDoc._id,
            estimateNumber: estimateDoc.estimateNumber || '',
            projectName: estimateDoc.projectName || '',
            status: estimateDoc.status || '',
            sentAt: estimateDoc.sentAt || null,
          }
        : null;
      organized[key].jobs.push(enriched);
    });
    
    // Convert to array and sort by date (newest first)
    const result = Object.values(organized).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get completed jobs (FINAL_PAYMENT_CLOSED)
async function getCompletedJobs(req, res) {
  try {
    const jobs = await Job.find({ 
      stage: 'FINAL_PAYMENT_CLOSED',
      isDeadEstimate: { $ne: true }
      // Note: We include archived jobs here to keep a permanent list
    })
      .populate('customerId', CUSTOMER_CONTACT_FIELDS)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ updatedAt: -1, createdAt: -1 });
    
    // Organize by month/year based on explicit close date first.
    const organized = {};
    jobs.forEach(job => {
      const completionDate =
        job.completedClosedOutAt ||
        job.finalPayment?.paidAt ||
        job.updatedAt ||
        job.createdAt;
      if (!completionDate) return;
      
      const date = new Date(completionDate);
      const year = date.getFullYear();
      const month = date.getMonth(); // 0-11
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleString('default', { month: 'long' });
      
      if (!organized[key]) {
        organized[key] = {
          year,
          month: month + 1,
          monthName,
          jobs: []
        };
      }
      
      organized[key].jobs.push(job);
    });
    
    // Convert to array and sort by date (newest first)
    const result = Object.values(organized).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Keep getDeadEstimates for backward compatibility (now returns archived jobs)
const getDeadEstimates = getArchivedJobs;

// Move job to dead estimates
async function moveToDeadEstimates(req, res) {
  try {
    const User = require('../models/User');
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (job.isDeadEstimate) {
      return res.status(400).json({ error: 'Job is already marked as dead estimate' });
    }
    
    const archiveDate = new Date();
    job.isDeadEstimate = true;
    job.movedToDeadEstimateAt = archiveDate;
    
    // Handle createdBy for note and activity
    let createdBy = req.user?._id || job.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      }
    }
    
    // Format timestamp for note
    const timestamp = archiveDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    // Add timestamped note to job's notes array
    if (createdBy) {
      job.notes.push({
        content: `Job moved to archive on ${timestamp} - no response after 5 days`,
        createdBy: createdBy,
        createdAt: archiveDate
      });
    }
    
    await job.save();
    
    // Log activity with timestamp
    if (createdBy) {
      await Activity.create({
        type: 'job_archived',
        jobId: job._id,
        customerId: job.customerId,
        note: `Moved to archive on ${timestamp} - no response after 5 days`,
        createdBy: createdBy
      });
    }
    
    await job.populate('customerId', CUSTOMER_CONTACT_FIELDS);
    await job.populate('assignedTo', 'name email');

    await emitJobUpdated(req, job);
    
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Auto-move jobs based on stage timers:
// 1. ESTIMATE_IN_PROGRESS -> ESTIMATE_SENT after 5 days
// 2. ESTIMATE_SENT -> Archive after 5 days
async function autoMoveDeadEstimates(req, res) {
  try {
    const mongoose = require('mongoose');
    
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        error: 'Database connection unavailable',
        message: 'MongoDB is not connected. Please check your connection settings.'
      });
    }

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    
    const movedToSent = [];
    const movedToArchive = [];
    const errors = [];
    
    // Step 1: Move jobs from ESTIMATE_IN_PROGRESS to ESTIMATE_SENT after 5 days
    // Use updatedAt to track when job entered ESTIMATE_IN_PROGRESS (or createdAt if never moved)
    const jobsToMoveToSent = await Job.find({
      stage: 'ESTIMATE_IN_PROGRESS',
      $or: [
        { updatedAt: { $lte: fiveDaysAgo } },
        { createdAt: { $lte: fiveDaysAgo }, updatedAt: { $exists: false } }
      ],
      isDeadEstimate: { $ne: true },
      isArchived: { $ne: true }
    });
    
    console.log(`Found ${jobsToMoveToSent.length} jobs to move from ESTIMATE_IN_PROGRESS to ESTIMATE_SENT`);
    
    for (const job of jobsToMoveToSent) {
      try {
        job.stage = 'ESTIMATE_SENT';
        const sentAt = new Date();
        const estimateDoc = await Estimate.findOne({ jobId: job._id }).sort({ createdAt: -1 });
        if (estimateDoc) {
          estimateDoc.status = 'sent';
          estimateDoc.sentAt = estimateDoc.sentAt || sentAt;
          estimateDoc.updatedBy = job.createdBy || estimateDoc.updatedBy;
          await estimateDoc.save();
        } else {
          warnLegacyEstimateUsage('autoMoveDeadEstimates missing estimate doc for ESTIMATE_IN_PROGRESS job', {
            jobId: String(job._id),
          });
        }
        await job.save();
        
        // Add stage change note
        const User = require('../models/User');
        const { STAGE_LABELS } = require('../utils/stageConfig');
        let createdBy = job.createdBy;
        if (!createdBy) {
          const defaultUser = await User.findOne({ isActive: true });
          if (defaultUser) {
            createdBy = defaultUser._id;
          }
        }
        
        if (createdBy) {
          job.notes.push({
            content: `Stage changed: ${STAGE_LABELS.ESTIMATE_IN_PROGRESS} → ${STAGE_LABELS.ESTIMATE_SENT} (auto-moved after 5 days)`,
            createdBy: createdBy,
            isStageChange: true
          });
          await job.save();
          
          // Log activity
          try {
            await Activity.create({
              type: 'stage_change',
              jobId: job._id,
              customerId: job.customerId,
              fromStage: 'ESTIMATE_IN_PROGRESS',
              toStage: 'ESTIMATE_SENT',
              note: `Auto-moved to ESTIMATE_SENT after 5 days`,
              createdBy: createdBy
            });
          } catch (activityError) {
            console.error(`Error creating activity for job ${job._id}:`, activityError.message);
          }
        }
        
        movedToSent.push(job._id);
        await emitJobUpdated(req, job);
      } catch (jobError) {
        console.error(`Error moving job ${job._id} to ESTIMATE_SENT:`, jobError.message);
        errors.push({ jobId: job._id, error: jobError.message });
      }
    }
    
    // Step 2: Move jobs from ESTIMATE_SENT to archive after 5 days
    const sentStageJobs = await Job.find({
      stage: 'ESTIMATE_SENT',
      isDeadEstimate: { $ne: true },
      isArchived: { $ne: true }
    });
    const sentEstimateMap = await getLatestEstimateMapByJobIds(sentStageJobs.map((j) => j._id));
    const jobsToArchive = sentStageJobs.filter((job) => {
      if (isWithinRestoreGracePeriod(job)) return false;
      const est = sentEstimateMap.get(String(job._id));
      return est?.status === 'sent' && est?.sentAt && new Date(est.sentAt) <= fiveDaysAgo;
    });
    
    console.log(`Found ${jobsToArchive.length} jobs to move to archive from ESTIMATE_SENT`);
    
    for (const job of jobsToArchive) {
      try {
        const archiveDate = new Date();
        job.isDeadEstimate = true;
        job.movedToDeadEstimateAt = archiveDate;
        
        // Format timestamp for note
        const timestamp = archiveDate.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        
        // Add timestamped note to job's notes array
        if (job.createdBy) {
          job.notes.push({
            content: `Job auto-archived on ${timestamp} - no response after 5 days`,
            createdBy: job.createdBy,
            createdAt: archiveDate
          });
        }
        
        await job.save();
        
        // Only create activity if we have a createdBy
        if (job.createdBy) {
          try {
            await Activity.create({
              type: 'job_archived',
              jobId: job._id,
              customerId: job.customerId,
              note: `Auto-moved to archive on ${timestamp} - no response after 5 days`,
              createdBy: job.createdBy
            });
          } catch (activityError) {
            console.error(`Error creating activity for job ${job._id}:`, activityError.message);
          }
        }
        
        movedToArchive.push(job._id);
        await emitJobUpdated(req, job);
      } catch (jobError) {
        console.error(`Error archiving job ${job._id}:`, jobError.message);
        errors.push({ jobId: job._id, error: jobError.message });
      }
    }
    
    const response = { 
      message: `Moved ${movedToSent.length} jobs to ESTIMATE_SENT, ${movedToArchive.length} jobs to archive`,
      movedToSent: movedToSent.length,
      movedToArchive: movedToArchive.length,
      jobIdsToSent: movedToSent,
      jobIdsToArchive: movedToArchive
    };
    
    if (errors.length > 0) {
      response.errors = errors;
    }
    
    // If called from frontend (no res object), return the response
    if (res) {
      res.json(response);
    } else {
      return response;
    }
  } catch (error) {
    console.error('Error in autoMoveDeadEstimates:', error);
    console.error('Error stack:', error.stack);
    
    // Check if it's a connection error
    if (error.message && error.message.includes('buffering timed out')) {
      if (res) {
        return res.status(503).json({ 
          error: 'Database connection timeout',
          message: 'MongoDB connection timed out. Please check your connection settings and IP whitelist.'
        });
      }
      throw error;
    }
    
    if (res) {
      res.status(500).json({ error: error.message, details: error.stack });
    } else {
      throw error;
    }
  }
}

// Debug endpoint to check which jobs should be moved
async function debugDeadEstimates(req, res) {
  try {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    
    // Find all ESTIMATE_IN_PROGRESS jobs
    const allEstimateInProgress = await Job.find({
      stage: 'ESTIMATE_IN_PROGRESS',
      isArchived: { $ne: true },
      isDeadEstimate: { $ne: true }
    }).select('title createdAt updatedAt isDeadEstimate');
    
    // Find all ESTIMATE_SENT jobs
    const allEstimateSent = await Job.find({
      stage: 'ESTIMATE_SENT',
      isArchived: { $ne: true },
      isDeadEstimate: { $ne: true }
    }).select('title isDeadEstimate');
    const sentMap = await getLatestEstimateMapByJobIds(allEstimateSent.map((j) => j._id));
    
    // Find jobs that should move from ESTIMATE_IN_PROGRESS to ESTIMATE_SENT
    const shouldMoveToSent = await Job.find({
      stage: 'ESTIMATE_IN_PROGRESS',
      $or: [
        { updatedAt: { $lte: fiveDaysAgo } },
        { createdAt: { $lte: fiveDaysAgo }, updatedAt: { $exists: false } }
      ],
      isDeadEstimate: { $ne: true },
      isArchived: { $ne: true }
    }).select('title createdAt updatedAt isDeadEstimate');
    
    // Find jobs that should be archived from ESTIMATE_SENT
    const sentStageJobs = await Job.find({
      stage: 'ESTIMATE_SENT',
      isDeadEstimate: { $ne: true },
      isArchived: { $ne: true }
    }).select('title isDeadEstimate');
    const shouldArchive = sentStageJobs.filter((job) => {
      const est = sentMap.get(String(job._id));
      return est?.status === 'sent' && est?.sentAt && new Date(est.sentAt) <= fiveDaysAgo;
    });
    
    res.json({
      fiveDaysAgo: fiveDaysAgo.toISOString(),
      allEstimateInProgressJobs: allEstimateInProgress.map(job => ({
        title: job.title,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        isDeadEstimate: job.isDeadEstimate,
        daysSince: Math.floor((new Date() - new Date(job.updatedAt || job.createdAt)) / (1000 * 60 * 60 * 24))
      })),
      allEstimateSentJobs: allEstimateSent.map(job => ({
        title: job.title,
        sentAt: sentMap.get(String(job._id))?.sentAt || null,
        isDeadEstimate: job.isDeadEstimate,
        daysSince: sentMap.get(String(job._id))?.sentAt ? Math.floor((new Date() - new Date(sentMap.get(String(job._id)).sentAt)) / (1000 * 60 * 60 * 24)) : null
      })),
      shouldMoveToSentCount: shouldMoveToSent.length,
      shouldMoveToSentJobs: shouldMoveToSent.map(job => ({
        title: job.title,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        isDeadEstimate: job.isDeadEstimate,
        daysSince: Math.floor((new Date() - new Date(job.updatedAt || job.createdAt)) / (1000 * 60 * 60 * 24))
      })),
      shouldArchiveCount: shouldArchive.length,
      shouldArchiveJobs: shouldArchive.map(job => ({
        title: job.title,
        sentAt: sentMap.get(String(job._id))?.sentAt || null,
        isDeadEstimate: job.isDeadEstimate,
        daysSince: sentMap.get(String(job._id))?.sentAt ? Math.floor((new Date() - new Date(sentMap.get(String(job._id)).sentAt)) / (1000 * 60 * 60 * 24)) : null
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Archive a job manually
async function archiveJob(req, res) {
  try {
    const User = require('../models/User');
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (job.isArchived) {
      return res.status(400).json({ error: 'Job is already archived' });
    }
    
    const archiveDate = new Date();
    job.isArchived = true;
    job.archivedAt = archiveDate;
    
    // Handle createdBy for note and activity
    let createdBy = req.user?._id || job.archivedBy || job.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      }
    }
    
    if (req.user) {
      job.archivedBy = req.user._id;
    }
    
    // Format timestamp for note
    const timestamp = archiveDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    // Add timestamped note to job's notes array
    if (createdBy) {
      job.notes.push({
        content: `Job archived on ${timestamp}`,
        createdBy: createdBy,
        createdAt: archiveDate
      });
    }
    
    await job.save();
    
    // Always log archive to recent activity (use job.createdBy if we still have no user)
    const activityCreatedBy = createdBy || job.createdBy;
    if (activityCreatedBy) {
      await Activity.create({
        type: 'job_archived',
        jobId: job._id,
        customerId: job.customerId,
        note: `Job archived on ${timestamp}`,
        createdBy: activityCreatedBy
      });
    }
    
    await job.populate('customerId', CUSTOMER_CONTACT_FIELDS);
    await job.populate('assignedTo', 'name email');

    await emitJobUpdated(req, job);

    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Unarchive a job (restore from archive — manually archived and/or dead estimate)
async function unarchiveJob(req, res) {
  try {
    const User = require('../models/User');
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const wasArchived = !!job.isArchived;
    const wasDeadEstimate = !!job.isDeadEstimate;

    if (!wasArchived && !wasDeadEstimate) {
      return res.status(400).json({ error: 'Job is not in the archive' });
    }
    
    const unarchiveDate = new Date();

    if (wasArchived) {
      job.isArchived = false;
      job.archivedAt = undefined;
      job.archivedBy = undefined;
    }

    if (wasDeadEstimate) {
      job.isDeadEstimate = false;
      job.movedToDeadEstimateAt = undefined;
    }

    // Completed close-out hides jobs from the active pipeline even when not archived
    job.isCompletedClosedOut = false;
    job.completedClosedOutAt = undefined;
    job.completedClosedOutBy = undefined;

    job.restoredFromArchiveAt = unarchiveDate;
    job.stage = normalizeStageForPipelineRestore(job.stage);
    
    // Handle createdBy for note and activity
    let createdBy = req.user?._id || job.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      }
    }
    
    // Format timestamp for note
    const timestamp = unarchiveDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    // Add timestamped note to job's notes array
    if (createdBy) {
      job.notes.push({
        content: `Job restored from archive on ${timestamp}`,
        createdBy: createdBy,
        createdAt: unarchiveDate
      });
    }
    
    await job.save();
    
    // Log activity with timestamp
    if (createdBy) {
      await Activity.create({
        type: 'job_updated',
        jobId: job._id,
        customerId: job.customerId,
        note: `Job restored from archive on ${timestamp}`,
        createdBy: createdBy
      });
    }
    
    await job.populate('customerId', CUSTOMER_CONTACT_FIELDS);
    await job.populate('assignedTo', 'name email');

    await emitJobUpdated(req, job);
    
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Close out all jobs in FINAL_PAYMENT_CLOSED stage (separate from archive/dead-estimate workflow)
async function archiveCompletedJobs(req, res) {
  try {
    const User = require('../models/User');
    
    // Find all completed jobs that are not already closed out.
    // Include previously-archived completed jobs so we can recover them into completed-history-only.
    const jobsToArchive = await Job.find({
      stage: 'FINAL_PAYMENT_CLOSED',
      isDeadEstimate: { $ne: true },
      isCompletedClosedOut: { $ne: true },
    });

    if (jobsToArchive.length === 0) {
      return res.json({ 
        message: 'No completed jobs to close out',
        archived: 0,
        jobIds: []
      });
    }

    const archiveDate = new Date();
    const archivedIds = [];
    
    // Handle createdBy for notes and activities
    let createdBy = req.user?._id;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      }
    }

    // Format timestamp for note
    const timestamp = archiveDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Close out each completed job without putting it in Job Archive.
    for (const job of jobsToArchive) {
      // Explicitly ensure completed jobs are not treated as archived jobs.
      job.isArchived = false;
      job.archivedAt = undefined;
      job.archivedBy = undefined;
      job.isCompletedClosedOut = true;
      job.completedClosedOutAt = archiveDate;
      job.completedClosedOutBy = createdBy || undefined;

      // Add timestamped note
      if (createdBy) {
        job.notes.push({
          content: `Job closed out on ${timestamp} (completed jobs close-out)`,
          createdBy: createdBy,
          createdAt: archiveDate
        });
      }

      await job.save();
      archivedIds.push(job._id);
      await emitJobUpdated(req, job);

      // Log activity
      if (createdBy) {
        try {
          await Activity.create({
            type: 'job_updated',
            jobId: job._id,
            customerId: job.customerId,
            note: `Job closed out on ${timestamp} - Final Payment Closed`,
            createdBy: createdBy
          });
        } catch (activityError) {
          console.error(`Error creating activity for job ${job._id}:`, activityError.message);
        }
      }
    }

    res.json({
      message: `Successfully closed out ${archivedIds.length} completed job(s)`,
      archived: archivedIds.length,
      jobIds: archivedIds
    });
  } catch (error) {
    console.error('Error archiving completed jobs:', error);
    res.status(500).json({ error: error.message });
  }
}

/** Move a FINAL_PAYMENT_CLOSED job back to the pipeline (e.g. payment not received yet after close-out). */
async function reopenFromCompleted(req, res) {
  try {
    const User = require('../models/User');
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }

    const job = await Job.findById(id);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    if (job.isDeadEstimate) {
      return res.status(400).json({ error: 'This action does not apply to dead-estimate jobs' });
    }
    if (job.stage !== 'FINAL_PAYMENT_CLOSED') {
      return res.status(400).json({
        error: 'Only jobs in Final Payment Closed can be returned to the pipeline',
      });
    }

    const reopenDate = new Date();
    const previousStage = job.stage;
    job.stage = 'INSTALLED';
    job.isCompletedClosedOut = false;
    job.completedClosedOutAt = null;
    job.completedClosedOutBy = null;
    // Completed list can include jobs that were also archived; clear archive so the job shows on the pipeline.
    job.isArchived = false;
    job.archivedAt = undefined;
    job.archivedBy = undefined;

    let createdBy = req.user?._id || job.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      }
    }

    const timestamp = reopenDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (createdBy) {
      job.notes.push({
        content: `Job returned to pipeline from Completed Jobs on ${timestamp} (stage: ${previousStage} → INSTALLED)`,
        createdBy,
        createdAt: reopenDate,
      });
    }

    await job.save();

    if (createdBy) {
      try {
        await Activity.create({
          type: 'stage_change',
          jobId: job._id,
          customerId: job.customerId,
          fromStage: previousStage,
          toStage: 'INSTALLED',
          note: `Returned to pipeline from completed list on ${timestamp}`,
          createdBy,
          ...(job.tenantId ? { tenantId: job.tenantId } : {}),
        });
      } catch (activityErr) {
        console.error('reopenFromCompleted: activity log failed (job was still reopened):', activityErr);
      }
    }

    await job.populate('customerId', CUSTOMER_CONTACT_FIELDS);
    await job.populate('assignedTo', 'name email');

    await emitJobUpdated(req, job);

    res.json(job);
  } catch (error) {
    console.error('Error reopening job from completed:', error);
    res.status(500).json({
      error: error.message || 'Failed to reopen job',
      detail: process.env.NODE_ENV === 'development' ? String(error) : undefined,
    });
  }
}

/**
 * Admin utility: wipe estimate snapshots across tenant jobs.
 * Intended as a temporary reset action during estimate flow cleanup.
 */
async function resetAllEstimates(req, res) {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can reset estimate history' });
    }

    const result = await Job.updateMany(
      {},
      {
        $unset: { estimate: 1 },
        $set: { estimateHistory: [], valueEstimated: 0 },
      }
    );

    return res.json({
      message: 'Estimate history reset for this organization',
      matched: result?.matchedCount ?? 0,
      modified: result?.modifiedCount ?? 0,
    });
  } catch (error) {
    console.error('Error resetting estimates:', error);
    return res.status(500).json({ error: error.message || 'Failed to reset estimates' });
  }
}

async function getReferralCompanies(req, res) {
  try {
    const Customer = require('../models/Customer');
    const pipeline = [
      { $match: { referralCompany: { $gt: '' } } },
      {
        $group: {
          _id: { $toLower: '$referralCompany' },
          name: { $first: '$referralCompany' },
          count: { $sum: 1 },
        },
      },
    ];
    const [jobRows, customerRows] = await Promise.all([
      Job.aggregate(pipeline),
      Customer.aggregate(pipeline),
    ]);
    const merged = new Map();
    for (const row of [...jobRows, ...customerRows]) {
      const key = String(row._id || '').trim();
      if (!key) continue;
      const existing = merged.get(key);
      if (existing) {
        existing.count += Number(row.count) || 0;
      } else {
        merged.set(key, { name: String(row.name || '').trim(), count: Number(row.count) || 0 });
      }
    }
    const companies = [...merged.values()]
      .filter((row) => row.name)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((row) => row.name)
      .slice(0, 80);
    res.json({ companies });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load referring companies' });
  }
}

module.exports = {
  getJobs,
  getJob,
  createJob,
  updateJob,
  moveJobStage,
  deleteJob,
  getPipelineSummary,
  getDeadEstimates,
  getArchivedJobs,
  getCompletedJobs,
  moveToDeadEstimates,
  autoMoveDeadEstimates,
  archiveJob,
  unarchiveJob,
  archiveCompletedJobs,
  reopenFromCompleted,
  resetAllEstimates,
  addJobInvoice,
  debugDeadEstimates,
  getReferralCompanies,
};