const Activity = require('../models/Activity');
const { sendUnsentPaymentNotifications, sendManualPaymentNotification } = require('../services/paymentNotificationService');

/**
 * YYYY-MM-DD as local calendar day bounds (matches browser <input type="date" />).
 * new Date("2026-04-21") is UTC midnight and can exclude/include the wrong rows vs user intent.
 */
function localDayBoundsFromYmd(startYmd, endYmd) {
  const a = String(startYmd).split('-').map(Number);
  const b = String(endYmd).split('-').map(Number);
  if (a.length < 3 || b.length < 3) return null;
  const [sy, sm, sd] = a;
  const [ey, em, ed] = b;
  const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
  const end = new Date(ey, em - 1, ed, 23, 59, 59, 999);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start > end) return null;
  return { start, end };
}

const STAGE_LABELS = {
  APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
  ESTIMATE_IN_PROGRESS: 'Estimate In Progress',
  ESTIMATE_SENT: 'Estimate Sent',
  ENGAGED_DESIGN_REVIEW: 'Design Review',
  CONTRACT_OUT: 'Contract Out',
  CONTRACT_SIGNED: 'Contract Signed',
  DEPOSIT_PENDING: 'Deposit Pending',
  JOB_PREP: 'Job Prep',
  TAKEOFF_COMPLETE: 'Fabrication',
  READY_TO_SCHEDULE: 'Ready to Schedule',
  SCHEDULED: 'Scheduled',
  IN_PRODUCTION: 'In Production',
  INSTALLED: 'Installed',
  FINAL_PAYMENT_CLOSED: 'Final Payment Closed',
};

function humanActivityTitle(activity) {
  switch (activity.type) {
    case 'stage_change': {
      const fromLabel = activity.fromStage ? STAGE_LABELS[activity.fromStage] || activity.fromStage : 'Unknown';
      const toLabel = activity.toStage ? STAGE_LABELS[activity.toStage] || activity.toStage : 'Unknown';
      return `Stage: ${fromLabel} → ${toLabel}`;
    }
    case 'note':
      return 'Note';
    case 'sms':
      return 'Text';
    case 'job_created':
      return 'Job Created';
    case 'job_updated':
      return 'Job Updated';
    case 'job_archived':
      return 'Job Archived';
    case 'file_uploaded':
      return 'File Uploaded';
    case 'file_deleted':
      return 'File Deleted';
    case 'meeting':
    case 'job_scheduled':
      return 'Scheduled';
    case 'appointment_created':
      return 'Appointment Created';
    case 'appointment_completed':
      return 'Appointment Completed';
    case 'appointment_deleted':
      return 'Appointment Deleted';
    case 'task_created':
      return 'Task Created';
    case 'task_deleted':
      return 'Task Deleted';
    case 'project_created':
      return 'Project Created';
    case 'project_updated':
      return 'Project Updated';
    case 'project_deleted':
      return 'Project Deleted';
    case 'task_completed':
      return 'Task Completed';
    case 'project_note_added':
      return 'Project Note Added';
    case 'payroll_printed':
      return 'Payroll Printed';
    case 'manual_entry':
      return 'Manual entry';
    default:
      return activity.type?.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) || 'Activity';
  }
}

function humanActivityDetail(activity) {
  if (activity.note) {
    return activity.note;
  }
  if (activity.type === 'job_updated' && activity.changes) {
    const entries = Object.entries(activity.changes);
    if (entries.length > 0) {
      const [field, change] = entries[0];
      const fromVal = change?.from ?? 'empty';
      const toVal = change?.to ?? 'empty';
      const more = entries.length > 1 ? ` (+${entries.length - 1} more)` : '';
      return `${field}: ${fromVal} → ${toVal}${more}`;
    }
  }
  if (activity.jobId?.title) {
    return activity.jobId.title;
  }
  if (activity.taskId?.title) {
    return activity.taskId.title;
  }
  if (activity.customerId?.name) {
    return activity.customerId.name;
  }
  if (activity.fileName) {
    return activity.fileName;
  }
  return '';
}

const MAX_LINE_DETAIL_CHARS = 400;

/**
 * Chronological order (oldest first) for a readable day narrative.
 */
function sortActivitiesForSummary(activities) {
  return [...activities].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
}

function formatActivityLineForSummary(activity) {
  const iso = new Date(activity.createdAt).toISOString();
  const action = humanActivityTitle(activity);
  let detail = humanActivityDetail(activity);
  if (detail.length > MAX_LINE_DETAIL_CHARS) {
    detail = `${detail.slice(0, MAX_LINE_DETAIL_CHARS)}…`;
  }
  const user = activity.createdBy?.name || '';
  const customer = activity.customerId?.name || '';
  const job = activity.jobId?.title || '';
  const taskLabel = activity.taskId?.title || '';
  const taskKind = activity.taskId?.isProject ? 'Project' : 'Task';
  const name = customer || job || '—';
  const taskPart = taskLabel ? ` | ${taskKind}: ${taskLabel}` : '';
  return `${iso} | Name: ${name} | ${action}${taskPart} | User: ${user || '—'} | ${detail || '—'}`;
}

/** gpt-4o-mini: keep room for full work logs; if truncated, the tail (latest events) is dropped last after chronological sort. */
const MAX_ACTIVITY_TEXT_CHARS = Math.min(
  500_000,
  Math.max(100_000, parseInt(String(process.env.OPENAI_SUMMARY_MAX_ACTIVITY_CHARS || '250000'), 10) || 250_000)
);

/**
 * @param {string[]} activityLines - chronological oldest-first (tail may be cut if over size limit)
 * @returns {{ text: string, includedLineCount: number, omittedLineCount: number }}
 */
function buildActivityListForModel(activityLines) {
  if (activityLines.length === 0) {
    return { text: '(none)', includedLineCount: 0, omittedLineCount: 0 };
  }
  const lines = [];
  let charBudget = 0;
  for (const line of activityLines) {
    const need = (lines.length > 0 ? 1 : 0) + line.length;
    if (charBudget + need > MAX_ACTIVITY_TEXT_CHARS) break;
    lines.push(line);
    charBudget += need;
  }
  const includedLineCount = lines.length;
  const omittedLineCount = activityLines.length - includedLineCount;
  const suffix =
    omittedLineCount > 0
      ? `\n[... ${omittedLineCount} line(s) omitted: payload size limit. List is chronological (oldest first); omitted lines are the latest events in the range.]`
      : '';
  return { text: `${lines.join('\n')}${suffix}`, includedLineCount, omittedLineCount };
}

const _timeoutRaw = parseInt(String(process.env.OPENAI_SUMMARY_TIMEOUT_MS || '120000'), 10);
const OPENAI_FETCH_TIMEOUT_MS = Number.isFinite(_timeoutRaw)
  ? Math.min(180_000, Math.max(10_000, _timeoutRaw))
  : 120_000;

/** Pasted multiline values in Render/hosts can break the key; strip all whitespace. */
function normalizeOpenAIApiKey(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  s = s.replace(/\s+/g, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

const MAX_SUMMARY_INSTRUCTIONS_CHARS = Math.min(
  4000,
  Math.max(500, parseInt(String(process.env.OPENAI_SUMMARY_INSTRUCTIONS_MAX_CHARS || '2000'), 10) || 2000)
);

async function openAiSummarizeActivities({
  startDateStr,
  endDateStr,
  activityLines,
  totalActivityCount,
  userInstructions,
}) {
  if (typeof globalThis.fetch !== 'function') {
    const err = new Error(
      'This Node build has no global fetch. Use Node 18+ on the server (set engines in package.json and on Render).'
    );
    err.code = 'NO_FETCH';
    throw err;
  }

  // OPENAI_API_KEY (correct spelling) — also accept common misspelling OPENNAI_API_KEY
  const apiKey = normalizeOpenAIApiKey(
    process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENNAI_API_KEY
  );
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY_NOT_SET');
    err.code = 'NO_KEY';
    throw err;
  }

  const systemPrompt = [
    'You summarize internal CRM activity for a woodworking / cabinetry business.',
    'The activity list is chronological (oldest first). Each input line has Name (customer or fallback label), an action type, optional Task/Project title, and optional detail text.',
    'OUTPUT STYLE — Keep each bullet minimal: **Name** — short description of what happened (the action only). Do NOT include job titles as labels, dollar amounts, estimates, contracted values, or phrases like "Job:", "Value:", or currency.',
    'REQUIREMENT: Cover every distinct customer / name from the data at least once when relevant; use sub-bullets only when needed. Do not skip smaller accounts.',
    'If developer-only or internal tasks are present, put them under "## Scheduling and tasks" where appropriate.',
    'PROJECT UPDATES: Any activity that is clearly about a **project** (input action types Project Created, Project Updated, Project Deleted, Project Note Added, or any line that includes "Project:" in the task part) belongs under "## Project updates" only — do not put those under "## Notable notes". General job/customer notes stay under Notable notes.',
    'Return valid markdown. Use exactly these headings in order: "## Date range overview", "## Customer and job movement", "## Project updates", "## Notable notes", "## Scheduling and tasks", "## Follow-ups".',
    'Use compact bullets under each section. If the user included extra instructions, honor them when consistent with the activity list. Do not invent facts.',
    'If there is no activity, return: "## Date range overview\\n- No activity recorded in this range."',
  ].join(' ');

  const { text: activityListText, includedLineCount, omittedLineCount } = buildActivityListForModel(activityLines);

  const trimmedInstructions =
    typeof userInstructions === 'string'
      ? userInstructions.trim().slice(0, MAX_SUMMARY_INSTRUCTIONS_CHARS)
      : '';

  const sections = [];
  if (trimmedInstructions) {
    sections.push(
      `Additional instructions from the user (honor these when consistent with the activity list; do not invent facts):\n${trimmedInstructions}`,
      ''
    );
  }
  sections.push(
    `Date range (inclusive): ${startDateStr} through ${endDateStr}`,
    `Total activities in this date range (in database): ${totalActivityCount}`,
    `This prompt includes ${includedLineCount} event line(s) in the list below, in chronological order (oldest first).${omittedLineCount > 0 ? ` ${omittedLineCount} more line(s) were omitted only due to size limits (the latest events in the range).` : ''}`,
    '',
    'Activities (each line: timestamp | Name | action | optional Task/Project | user | detail):',
    '---',
    activityListText,
    '---'
  );
  const userContent = sections.join('\n');

  const model = (process.env.OPENAI_ACTIVITY_SUMMARY_MODEL || 'gpt-4o-mini').trim();

  const body = {
    model,
    temperature: 0.35,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };

  /** Some orgs / project keys (sk-proj-...) require these; see OpenAI dashboard (org + project). */
  const openaiHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  const org = (process.env.OPENAI_ORG_ID || process.env.OPENAI_ORGANIZATION || '').trim();
  if (org) {
    openaiHeaders['OpenAI-Organization'] = org;
  }
  const project = (process.env.OPENAI_PROJECT_ID || '').trim();
  if (project) {
    openaiHeaders['OpenAI-Project'] = project;
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OPENAI_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: openaiHeaders,
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(
        `OpenAI request timed out after ${OPENAI_FETCH_TIMEOUT_MS}ms. Try a shorter date range, or set OPENAI_SUMMARY_TIMEOUT_MS on the server.`
      );
      err.code = 'OPENAI_TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error(raw.slice(0, 500) || 'Invalid OpenAI response');
    err.code = 'OPENAI_BAD_JSON';
    throw err;
  }

  if (!res.ok) {
    const apiCode = data?.error?.code;
    const apiMsg = data?.error?.message || raw.slice(0, 500) || 'OpenAI request failed';
    const renderHint =
      res.status === 401
        ? ' In Render, set OPENAI_API_KEY. If the key is project-scoped (sk-proj-), also set OPENAI_PROJECT_ID (and OPENAI_ORG_ID if your org needs it) from the OpenAI dashboard. One line, no extra spaces. Redeploy after changes.'
        : '';
    const err = new Error(
      res.status === 401 ? `${apiMsg}${apiCode ? ` [${apiCode}]` : ''}.${renderHint}` : apiMsg
    );
    err.status = res.status;
    err.openai = data?.error;
    throw err;
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const err = new Error('OpenAI returned no summary text (empty choices).');
    err.code = 'OPENAI_EMPTY';
    throw err;
  }
  return text;
}

function formatAddressParts(parts) {
  return parts.filter(Boolean).join(', ');
}

function formatJobLocation(job) {
  const ja = job?.jobAddress;
  if (ja && (ja.street || ja.city || ja.state || ja.zip)) {
    return formatAddressParts([ja.street, ja.city, ja.state, ja.zip]);
  }
  const ca = job?.customerId?.address;
  if (ca && (ca.street || ca.city || ca.state || ca.zip)) {
    return formatAddressParts([ca.street, ca.city, ca.state, ca.zip]);
  }
  return '';
}

function formatScheduleBlock(job) {
  const schedule = job?.schedule || {};
  const entries = Array.isArray(schedule.entries) ? schedule.entries : [];
  const lines = [];
  if (entries.length > 0) {
    for (const e of entries) {
      if (!e?.startDate) continue;
      const start = new Date(e.startDate).toISOString();
      const end = e.endDate ? new Date(e.endDate).toISOString() : start;
      lines.push(
        `- Installer: ${e.installer || '—'} | ${start} → ${end}`
      );
    }
  } else if (schedule.startDate) {
    const start = new Date(schedule.startDate).toISOString();
    const end = schedule.endDate ? new Date(schedule.endDate).toISOString() : start;
    const inst = schedule.installer || (schedule.installers || []).join(', ') || '—';
    lines.push(`- Installer: ${inst} | ${start} → ${end}`);
  }
  if (schedule.crewNotes) {
    lines.push(`- Crew notes: ${String(schedule.crewNotes).slice(0, 500)}`);
  }
  return lines.length ? lines.join('\n') : '(none scheduled)';
}

function formatJobNotesBlock(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return '(none)';
  return [...notes]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((n) => {
      const iso = n.createdAt ? new Date(n.createdAt).toISOString() : '—';
      const author = n.createdByName || n.createdBy?.name || '—';
      const flags = [
        n.isStageChange ? 'stage-change' : null,
        n.important ? 'important' : null,
        n.isAppointment ? 'appointment' : null,
        n.isSms ? (n.smsDirection === 'inbound' ? 'text-received' : 'text-sent') : null,
      ]
        .filter(Boolean)
        .join(', ');
      const prefix = flags ? `[${flags}] ` : '';
      const content = String(n.content || '').slice(0, 800);
      return `${iso} | ${author} | ${prefix}${content}`;
    })
    .join('\n');
}

function formatTasksBlock(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return '(none)';
  return tasks
    .map((t) => {
      const due = t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '—';
      const status = t.completedAt ? 'completed' : 'open';
      const desc = t.description ? ` — ${String(t.description).slice(0, 200)}` : '';
      return `- [${status}] ${t.title || 'Task'} | due ${due}${desc}`;
    })
    .join('\n');
}

function formatAppointmentsBlock(appointments) {
  if (!Array.isArray(appointments) || appointments.length === 0) return '(none)';
  return appointments
    .map((a) => {
      const when = a.date ? new Date(a.date).toISOString().slice(0, 10) : '—';
      const loc = a.location ? ` @ ${a.location}` : '';
      return `- [${a.status || 'scheduled'}] ${a.title || 'Appointment'} | ${when} ${a.time || ''}${loc}`;
    })
    .join('\n');
}

function buildJobContextForSummary(job, activities, tasks, appointments) {
  const customer = job.customerId;
  const stageLabel = STAGE_LABELS[job.stage] || job.stage;
  const location = formatJobLocation(job);
  const activityLines = sortActivitiesForSummary(activities).map(formatActivityLineForSummary);
  const { text: activityText, includedLineCount, omittedLineCount } =
    buildActivityListForModel(activityLines);

  const sections = [
    '=== JOB ===',
    `Title: ${job.title || '—'}`,
    `Stage: ${stageLabel}`,
    `Customer: ${customer?.name || '—'}`,
    customer?.primaryPhone ? `Customer phone: ${customer.primaryPhone}` : null,
    customer?.primaryEmail ? `Customer email: ${customer.primaryEmail}` : null,
    job.assignedTo?.name ? `Assigned to: ${job.assignedTo.name}` : null,
    job.description ? `Description: ${String(job.description).slice(0, 1500)}` : null,
    typeof job.valueEstimated === 'number' ? `Estimated value: ${job.valueEstimated}` : null,
    typeof job.valueContracted === 'number' ? `Contracted value: ${job.valueContracted}` : null,
    job.createdAt ? `Job created: ${new Date(job.createdAt).toISOString()}` : null,
    '',
    '=== LOCATION / JOB SITE ===',
    location || '(no address on file)',
    job.jobContact?.phone ? `Job contact phone: ${job.jobContact.phone}` : null,
    job.jobContact?.email ? `Job contact email: ${job.jobContact.email}` : null,
    '',
    '=== INSTALL SCHEDULE ===',
    formatScheduleBlock(job),
    '',
    '=== JOB NOTES / UPDATES (chronological) ===',
    formatJobNotesBlock(job.notes),
    '',
    '=== ACTIVITY LOG (chronological) ===',
    `Included ${includedLineCount} activity row(s)${omittedLineCount > 0 ? ` (${omittedLineCount} omitted due to size limit)` : ''}.`,
    activityText,
    '',
    '=== TASKS ===',
    formatTasksBlock(tasks),
    '',
    '=== APPOINTMENTS ===',
    formatAppointmentsBlock(appointments),
  ];

  return sections.filter((line) => line !== null).join('\n');
}

async function openAiSummarizeJob({ jobContext, userInstructions }) {
  if (typeof globalThis.fetch !== 'function') {
    const err = new Error(
      'This Node build has no global fetch. Use Node 18+ on the server.'
    );
    err.code = 'NO_FETCH';
    throw err;
  }

  const apiKey = normalizeOpenAIApiKey(
    process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENNAI_API_KEY
  );
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY_NOT_SET');
    err.code = 'NO_KEY';
    throw err;
  }

  const systemPrompt = [
    'You summarize a single CRM job for a woodworking / cabinetry / install business.',
    'Use ONLY the data provided. Do not invent customers, dates, amounts, or outcomes.',
    'Return valid markdown with these headings in order:',
    '## Job overview',
    '## Location and site',
    '## Schedule and crew',
    '## Timeline and updates',
    '## Tasks and appointments',
    '## Current status and recommended follow-ups',
    'Keep bullets concise. Mention location/address when present. Highlight stage changes, scheduling, and open tasks.',
    'If data is sparse, say so briefly under the relevant section.',
  ].join(' ');

  const trimmedInstructions =
    typeof userInstructions === 'string'
      ? userInstructions.trim().slice(0, MAX_SUMMARY_INSTRUCTIONS_CHARS)
      : '';

  const userParts = [];
  if (trimmedInstructions) {
    userParts.push(
      `Additional instructions from the user:\n${trimmedInstructions}`,
      ''
    );
  }
  userParts.push('Job data:', '---', jobContext.slice(0, MAX_ACTIVITY_TEXT_CHARS), '---');
  const userContent = userParts.join('\n');

  const model = (process.env.OPENAI_ACTIVITY_SUMMARY_MODEL || 'gpt-4o-mini').trim();
  const body = {
    model,
    temperature: 0.35,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };

  const openaiHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  const org = (process.env.OPENAI_ORG_ID || process.env.OPENAI_ORGANIZATION || '').trim();
  if (org) openaiHeaders['OpenAI-Organization'] = org;
  const project = (process.env.OPENAI_PROJECT_ID || '').trim();
  if (project) openaiHeaders['OpenAI-Project'] = project;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OPENAI_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: openaiHeaders,
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(
        `OpenAI request timed out after ${OPENAI_FETCH_TIMEOUT_MS}ms.`
      );
      err.code = 'OPENAI_TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error(raw.slice(0, 500) || 'Invalid OpenAI response');
    err.code = 'OPENAI_BAD_JSON';
    throw err;
  }

  if (!res.ok) {
    const apiMsg = data?.error?.message || raw.slice(0, 500) || 'OpenAI request failed';
    const err = new Error(apiMsg);
    err.status = res.status;
    err.openai = data?.error;
    throw err;
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const err = new Error('OpenAI returned no summary text (empty choices).');
    err.code = 'OPENAI_EMPTY';
    throw err;
  }
  return text;
}

function handleOpenAiSummaryError(e, res) {
  if (e.code === 'NO_KEY') {
    return res.status(503).json({
      error:
        'OpenAI is not configured. Set OPENAI_API_KEY in your backend environment.',
      code: 'NO_KEY',
    });
  }
  if (e.code === 'NO_FETCH') {
    return res.status(500).json({ error: e.message, code: 'NO_FETCH' });
  }
  if (e.code === 'OPENAI_TIMEOUT') {
    return res.status(504).json({ error: e.message, code: 'OPENAI_TIMEOUT' });
  }
  console.error('Job summary OpenAI error:', e?.message, e?.status, e?.openai);
  return res.status(502).json({
    error: e.message || 'Failed to generate summary',
    code: e.code,
  });
}

// POST body: { prompt? } — optional focus instructions for the model
// jobId from route param (:jobId or :id) or body.jobId when using POST /activities/summary
async function generateJobSummary(req, res) {
  try {
    const Job = require('../models/Job');
    const Task = require('../models/Task');
    const Appointment = require('../models/Appointment');
    const jobId = req.params.jobId || req.params.id || req.body?.jobId;
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    const rawInstructions = req.body?.prompt ?? req.body?.instructions ?? '';
    const userInstructions =
      typeof rawInstructions === 'string' ? rawInstructions.slice(0, MAX_SUMMARY_INSTRUCTIONS_CHARS) : '';

    const job = await Job.findById(jobId)
      .populate('customerId')
      .populate('assignedTo', 'name email')
      .populate('notes.createdBy', 'name email');

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const MAX = 500;
    const [activities, tasks, appointments, totalActivities] = await Promise.all([
      Activity.find({ jobId: job._id })
        .populate('createdBy', 'name email')
        .populate('customerId', 'name')
        .populate('taskId', 'title isProject')
        .sort({ createdAt: -1 })
        .limit(MAX),
      Task.find({ jobId: job._id }).sort({ dueDate: 1, createdAt: -1 }).limit(100),
      Appointment.find({ jobId: job._id }).sort({ date: -1 }).limit(50),
      Activity.countDocuments({ jobId: job._id }),
    ]);

    const jobContext = buildJobContextForSummary(job, activities, tasks, appointments);

    let summary;
    try {
      summary = await openAiSummarizeJob({ jobContext, userInstructions });
    } catch (e) {
      return handleOpenAiSummaryError(e, res);
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.json({
      summary,
      activityCount: activities.length,
      totalActivities,
      truncated: totalActivities > MAX,
      noteCount: Array.isArray(job.notes) ? job.notes.length : 0,
      taskCount: tasks.length,
      appointmentCount: appointments.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('generateJobSummary:', error);
    res.status(500).json({ error: error.message });
  }
}

// Get activities for a job
async function getJobActivities(req, res) {
  try {
    const activities = await Activity.find({ jobId: req.params.jobId })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get activities for a customer
async function getCustomerActivities(req, res) {
  try {
    const activities = await Activity.find({ customerId: req.params.customerId })
      .populate('createdBy', 'name email')
      .populate('jobId', 'title')
      .sort({ createdAt: -1 });
    
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Create manual activity attached to a specific job (note, call, email, meeting)
async function createActivity(req, res) {
  try {
    const Job = require('../models/Job');
    
    const job = await Job.findById(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const activity = new Activity({
      ...req.body,
      jobId: job._id,
      customerId: job.customerId,
      createdBy: req.user._id
    });
    
    await activity.save();
    await activity.populate('createdBy', 'name email');
    
    res.status(201).json(activity);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Create a general/manual activity that can optionally stand alone
// (e.g. "08:30 worked on Wells Fargo billing - no job")
async function createManualActivity(req, res) {
  try {
    const User = require('../models/User');
    const Job = require('../models/Job');

    const { type, note, createdAt, jobId, customerId } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'Activity note is required' });
    }

    // Resolve createdBy (prefer authenticated user, fall back to any active user)
    let createdBy = req.user?._id || req.body.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (!defaultUser) {
        return res.status(400).json({ error: 'No user available to attribute activity to' });
      }
      createdBy = defaultUser._id;
    }

    const activityData = {
      type: type || 'manual_entry',
      note: note.trim(),
      createdBy,
    };

    // Optionally associate with a job and/or customer
    if (jobId) {
      const job = await Job.findById(jobId);
      if (job) {
        activityData.jobId = job._id;
        activityData.customerId = job.customerId;
      }
    } else if (customerId) {
      activityData.customerId = customerId;
    }

    // Allow overriding createdAt so you can log "at 08:30" style entries
    if (createdAt) {
      const customDate = new Date(createdAt);
      if (!isNaN(customDate.getTime())) {
        activityData.createdAt = customDate;
      }
    }

    const activity = await Activity.create(activityData);

    await activity.populate('createdBy', 'name email');
    await activity.populate('customerId', 'name');
    await activity.populate('jobId', 'title');

    res.status(201).json(activity);
  } catch (error) {
    console.error('Error creating manual activity:', error);
    res.status(500).json({ error: error.message });
  }
}

// Get recent activities (for dashboard)
async function getRecentActivities(req, res) {
  try {
    const { limit } = req.query;
    
    let query = Activity.find()
      .populate('createdBy', 'name email')
      .populate('customerId', 'name')
      .populate('jobId', 'title')
      .populate('taskId', 'title isProject')
      .sort({ createdAt: -1 });
    
    // Only apply limit if specified, otherwise return all
    if (limit) {
      query = query.limit(parseInt(limit));
    }
    
    const activities = await query;
    
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get activities by date range
async function getActivitiesByDateRange(req, res) {
  try {
    const { startDate, endDate, types } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const bounds = localDayBoundsFromYmd(startDate, endDate);
    if (!bounds) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    const { start, end } = bounds;

    let query = {
      createdAt: {
        $gte: start,
        $lte: end
      }
    };
    
    // Filter by activity types if provided
    if (types) {
      const typeArray = Array.isArray(types) ? types : types.split(',');
      query.type = { $in: typeArray };
    }
    
    const activities = await Activity.find(query)
      .populate('createdBy', 'name email')
      .populate('customerId', 'name')
      .populate('jobId', 'title')
      .populate('taskId', 'title isProject')
      .sort({ createdAt: -1 });
    
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Delete an activity
async function deleteActivity(req, res) {
  try {
    const activity = await Activity.findById(req.params.id);
    
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    
    await Activity.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Activity deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Log payroll print activity
async function logPayrollPrint(req, res) {
  try {
    const User = require('../models/User');
    const Customer = require('../models/Customer');
    const { employeeName } = req.body;
    
    if (!employeeName || !employeeName.trim()) {
      return res.status(400).json({ error: 'Employee name is required' });
    }
    
    // Get createdBy - use req.user if available, otherwise get default user
    let createdBy = req.user?._id || req.body.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      } else {
        return res.status(400).json({ error: 'No user available' });
      }
    }
    
    // Payroll isn't customer-specific, so don't assign a customer
    const activity = await Activity.create({
      type: 'payroll_printed',
      customerId: null,
      note: `Print "${employeeName.trim()}" Payroll timesheet`,
      createdBy: createdBy
    });
    
    console.log(`✅ Payroll print activity logged for "${employeeName}": ${activity._id}`);
    
    res.status(201).json(activity);
  } catch (error) {
    console.error('❌ Error logging payroll print:', error);
    res.status(500).json({ error: error.message });
  }
}

// POST body: { startDate, endDate, prompt? } — ISO dates; optional prompt / instructions for the model
// POST body: { jobId, prompt? } — summarize a single job (no date range)
async function generateActivitySummary(req, res) {
  try {
    if (req.body?.jobId) {
      return generateJobSummary(req, res);
    }

    const { startDate, endDate } = req.body || {};
    const rawInstructions = req.body?.prompt ?? req.body?.instructions ?? '';
    const userInstructions =
      typeof rawInstructions === 'string' ? rawInstructions.slice(0, MAX_SUMMARY_INSTRUCTIONS_CHARS) : '';

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const bounds = localDayBoundsFromYmd(startDate, endDate);
    if (!bounds) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    const { start, end } = bounds;

    const rangeFilter = { createdAt: { $gte: start, $lte: end } };
    const MAX = 500;
    const totalInRange = await Activity.countDocuments(rangeFilter);
    const activities = await Activity.find(rangeFilter)
      .populate('createdBy', 'name email')
      .populate('customerId', 'name')
      .populate('jobId', 'title')
      .populate('taskId', 'title isProject')
      .sort({ createdAt: -1 })
      .limit(MAX);

    if (activities.length === 0) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      return res.json({
        summary: 'No activity was recorded in this date range.',
        activityCount: 0,
        totalInRange: 0,
        truncated: false,
        newestActivityAt: null,
        generatedAt: new Date().toISOString(),
      });
    }

    const activitiesForSummary = sortActivitiesForSummary(activities);
    const lines = activitiesForSummary.map(formatActivityLineForSummary);
    const truncated = totalInRange > MAX;

    let summary;
    try {
      summary = await openAiSummarizeActivities({
        startDateStr: startDate,
        endDateStr: endDate,
        activityLines: lines,
        totalActivityCount: totalInRange,
        userInstructions,
      });
    } catch (e) {
      if (e.code === 'NO_KEY') {
        return res.status(503).json({
          error:
            'OpenAI is not configured. Set OPENAI_API_KEY (spelling: OPEN**AI**_API_KEY) in your backend host environment; OPENAI_KEY also works.',
          code: 'NO_KEY',
        });
      }
      if (e.code === 'NO_FETCH') {
        return res.status(500).json({ error: e.message, code: 'NO_FETCH' });
      }
      if (e.code === 'OPENAI_TIMEOUT') {
        return res.status(504).json({ error: e.message, code: 'OPENAI_TIMEOUT' });
      }
      console.error('Activity summary OpenAI error:', e?.message, e?.status, e?.openai);
      return res.status(502).json({
        error: e.message || 'Failed to generate summary',
        code: e.code,
        openaiType: e.openai?.type,
        openaiCode: e.openai?.code,
        openaiParam: e.openai?.param,
      });
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.json({
      summary,
      /** Rows sent to the model (capped) */
      activityCount: activities.length,
      /** Total activity rows in range in the database */
      totalInRange,
      truncated,
      newestActivityAt: activities[0]?.createdAt
        ? new Date(activities[0].createdAt).toISOString()
        : null,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('generateActivitySummary:', error);
    res.status(500).json({ error: error.message });
  }
}

async function sendUnsentPaymentNotificationAlerts(req, res) {
  try {
    if (!req.user || !['super_admin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to send payment alerts.' });
    }
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Your account is not linked to an organization.' });
    }

    const result = await sendUnsentPaymentNotifications({
      tenantId,
      createdBy: req.user._id,
      limit: req.body?.limit,
    });

    if (result.error) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('sendUnsentPaymentNotificationAlerts:', error);
    res.status(500).json({ error: error.message || 'Failed to send payment alerts' });
  }
}

async function sendManualPaymentNotificationAlert(req, res) {
  try {
    if (!req.user || !['super_admin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to send payment alerts.' });
    }
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Your account is not linked to an organization.' });
    }

    const result = await sendManualPaymentNotification({
      tenantId,
      createdBy: req.user._id,
      activityId: req.body?.activityId,
      jobId: req.body?.jobId,
      scheduleLabel: req.body?.scheduleLabel,
      force: Boolean(req.body?.force),
    });

    if (result.error && !result.alreadySent && (result.sentCount || 0) === 0) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('sendManualPaymentNotificationAlert:', error);
    res.status(500).json({ error: error.message || 'Failed to send payment alert' });
  }
}

module.exports = {
  getJobActivities,
  getCustomerActivities,
  createActivity,
  createManualActivity,
  getRecentActivities,
  getActivitiesByDateRange,
  generateActivitySummary,
  generateJobSummary,
  deleteActivity,
  logPayrollPrint,
  sendUnsentPaymentNotificationAlerts,
  sendManualPaymentNotificationAlert,
};