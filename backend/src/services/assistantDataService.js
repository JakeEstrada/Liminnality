const Activity = require('../models/Activity');
const Job = require('../models/Job');
const Customer = require('../models/Customer');
const Appointment = require('../models/Appointment');
const Task = require('../models/Task');
const ScheduledSms = require('../models/ScheduledSms');
const User = require('../models/User');
const EmployeeContact = require('../models/EmployeeContact');
const DepositAllocation = require('../models/DepositAllocation');
const PlaidRegisterCache = require('../models/PlaidRegisterCache');
const { formatJobLocation, inOrangeCounty } = require('./geocodeService');
const { lookupCityCenter, milesBetween } = require('./ocCityCenters');
const { resolveJobId } = require('../utils/resolveJobId');

const SHOP_TIMEZONE = 'America/Los_Angeles';

function clampLimit(raw, defaultLimit = 5, max = 20) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultLimit;
  return Math.min(Math.max(Math.floor(n), 1), max);
}

function formatMoney(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  return Number(Number(amount).toFixed(2));
}

function formatDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function isPlaidDepositTransaction(transaction) {
  return Number(transaction?.amount || 0) < 0;
}

function noteMatchesQuery(content, keywords) {
  if (!keywords.length) return true;
  const hay = String(content || '').toLowerCase();
  return keywords.every((kw) => hay.includes(kw.toLowerCase()));
}

/**
 * Recent customer payments logged in Paarth (payment_received activities).
 */
async function fetchRecentPayments({ limit: limitArg = 5 } = {}) {
  const limit = clampLimit(limitArg, 5, 15);
  const activities = await Activity.find({ type: 'payment_received' })
    .populate('customerId', 'name')
    .populate('jobId', 'title stage')
    .sort({ paymentPaidAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    payments: activities.map((a) => ({
      id: String(a._id),
      amount: formatMoney(a.amount),
      paidDate: formatDate(a.paymentPaidAt || a.createdAt),
      recordedAt: a.createdAt ? new Date(a.createdAt).toISOString() : null,
      paymentType: a.paymentType || null,
      paymentMethod: a.paymentMethod || null,
      note: a.note ? String(a.note).slice(0, 300) : null,
      customerName: a.customerId?.name || null,
      jobId: a.jobId?._id ? String(a.jobId._id) : null,
      jobTitle: a.jobId?.title || null,
      jobPath: a.jobId?._id ? `/customers?jobId=${a.jobId._id}` : null,
    })),
  };
}

function dateMs(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function looksLikeDepositActivity(activity) {
  if (activity?.type === 'deposit_received') return true;
  const blob = `${activity?.paymentType || ''} ${activity?.note || ''} ${activity?.paymentMethod || ''}`.toLowerCase();
  return /\bdeposit\b/.test(blob);
}

function depositMatchesName(row, nameQ) {
  if (!nameQ) return true;
  return nameMatches(row.customerName, nameQ) || nameMatches(row.jobTitle, nameQ);
}

function depositDedupeKey(row) {
  return `${row.jobId || row.id}|${row.amount || 0}|${row.date || ''}`;
}

function isPaidDepositScheduleItem(item) {
  if (!item || item.status !== 'paid') return false;
  const label = String(item.label || '');
  return item.dueType === 'deposit' || /\bdeposit\b/i.test(label);
}

function scheduleDepositRow(job, item) {
  return {
    id: `schedule:${job._id}:${item.sortOrder || item.label || 'deposit'}`,
    source: 'job_schedule_deposit',
    amount: formatMoney(item.paidAmount || item.amount),
    date: formatDate(item.paidAt),
    sortMs: dateMs(item.paidAt),
    customerName: job.customerId?.name || null,
    jobId: String(job._id),
    jobTitle: job.title || null,
    note: item.label || 'Deposit',
  };
}

async function loadScheduleDeposits({ nameQ, limit = 40 } = {}) {
  const query = {
    'paymentSchedule.items': {
      $elemMatch: {
        status: 'paid',
        $or: [{ dueType: 'deposit' }, { label: /deposit/i }],
      },
    },
  };
  if (nameQ) {
    const regex = new RegExp(escapeRegex(nameQ), 'i');
    const customers = await Customer.find({ name: regex }).select('_id').limit(25).lean();
    query.$or = [{ title: regex }, { customerId: { $in: customers.map((c) => c._id) } }];
  }

  const jobs = await Job.find(query)
    .populate('customerId', 'name')
    .select('title customerId paymentSchedule')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  const rows = [];
  for (const job of jobs) {
    for (const item of job.paymentSchedule?.items || []) {
      if (isPaidDepositScheduleItem(item)) rows.push(scheduleDepositRow(job, item));
    }
  }
  return rows;
}

/**
 * Recent customer/job deposits. Shop deposits are usually a paid deposit line
 * on the job schedule (payment_received), not only deposit_received CRM rows.
 */
async function fetchRecentDeposits({ tenantId, limit: limitArg = 5, customerQuery } = {}) {
  const limit = clampLimit(limitArg, 5, 15);
  const nameQ = String(customerQuery || '').trim();
  const scan = nameQ ? 200 : 80;

  const [activities, allocations, cache, scheduleDeposits] = await Promise.all([
    Activity.find({
      $or: [
        { type: 'deposit_received' },
        { type: 'payment_received', paymentType: /deposit/i },
        { type: 'payment_received', note: /deposit/i },
      ],
    })
      .populate('customerId', 'name')
      .populate({
        path: 'jobId',
        select: 'title customerId',
        populate: { path: 'customerId', select: 'name' },
      })
      .sort({ paymentPaidAt: -1, createdAt: -1 })
      .limit(scan)
      .lean(),
    DepositAllocation.find()
      .populate({
        path: 'jobId',
        select: 'title customerId',
        populate: { path: 'customerId', select: 'name' },
      })
      .sort({ linkedAt: -1, transactionDate: -1 })
      .limit(scan)
      .lean(),
    tenantId ? PlaidRegisterCache.findOne({ tenantId }).lean() : Promise.resolve(null),
    loadScheduleDeposits({ nameQ, limit: nameQ ? 40 : 40 }),
  ]);

  const shopDeposits = [];

  for (const activity of activities) {
    if (activity.type === 'payment_received' && !looksLikeDepositActivity(activity)) continue;
    const customerName = activity.customerId?.name || activity.jobId?.customerId?.name || null;
    const jobTitle = activity.jobId?.title || null;
    const row = {
      id: String(activity._id),
      source: activity.type === 'deposit_received' ? 'crm_deposit' : 'job_deposit',
      amount: formatMoney(activity.amount),
      date: formatDate(activity.paymentPaidAt || activity.createdAt),
      sortMs: dateMs(activity.paymentPaidAt || activity.createdAt),
      customerName,
      jobId: activity.jobId?._id ? String(activity.jobId._id) : null,
      jobTitle,
      note: activity.note ? String(activity.note).slice(0, 200) : null,
    };
    if (depositMatchesName(row, nameQ)) shopDeposits.push(row);
  }

  for (const allocation of allocations) {
    const isDepositLine =
      allocation.paymentDueType === 'deposit' || /\bdeposit\b/i.test(String(allocation.paymentLabel || ''));
    if (!isDepositLine && nameQ === '') {
      // Keep linked bank rows that are clearly deposits; skip milestone links for "most recent deposit".
      if (allocation.paymentDueType && allocation.paymentDueType !== 'deposit') continue;
    }
    const row = {
      id: String(allocation._id),
      source: 'bank_linked_to_job',
      amount: formatMoney(allocation.depositAmount),
      date: allocation.transactionDate || formatDate(allocation.linkedAt),
      sortMs: dateMs(allocation.transactionDate || allocation.linkedAt),
      bankDescription: allocation.transactionName || null,
      paymentLabel: allocation.paymentLabel || null,
      customerName: allocation.jobId?.customerId?.name || null,
      jobId: allocation.jobId?._id ? String(allocation.jobId._id) : String(allocation.jobId || ''),
      jobTitle: allocation.jobId?.title || null,
      markPaidApplied: Boolean(allocation.markPaidApplied),
    };
    if (depositMatchesName(row, nameQ)) shopDeposits.push(row);
  }

  for (const row of scheduleDeposits) {
    if (depositMatchesName(row, nameQ)) shopDeposits.push(row);
  }

  const seen = new Set();
  const unique = [];
  for (const row of shopDeposits.sort((a, b) => (b.sortMs || 0) - (a.sortMs || 0))) {
    const key = depositDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const { sortMs, ...rest } = row;
    unique.push(rest);
  }

  const linkedTxnIds = new Set(allocations.map((d) => String(d.plaidTransactionId)));
  const txs = Array.isArray(cache?.transactions) ? cache.transactions : [];
  const unlinkedBankInflows = nameQ
    ? []
    : txs
        .filter((t) => isPlaidDepositTransaction(t))
        .filter((t) => !linkedTxnIds.has(String(t.transaction_id || '')))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 3)
        .map((t) => ({
          id: String(t.transaction_id || ''),
          source: 'bank_register_unlinked',
          amount: formatMoney(Math.abs(Number(t.amount))),
          date: t.date || null,
          bankDescription: t.name || t.merchant_name || null,
        }));

  const deposits = unique.slice(0, limit);
  return {
    deposits,
    mostRecent: deposits[0] || null,
    matchedCustomer: nameQ || undefined,
    found: deposits.length > 0,
    unlinkedBankInflows,
    hint: nameQ
      ? `Customer/job deposits matching "${nameQ}". found=false means no deposit for that name.`
      : 'mostRecent is the latest customer/job deposit (paid deposit line, CRM deposit, or bank linked to a job). Do not treat unlinkedBankInflows as a customer deposit.',
  };
}

/**
 * Search job modal notes and crew notes across active jobs.
 */
async function searchJobNotes({ query, limit: limitArg = 12 } = {}) {
  const limit = clampLimit(limitArg, 12, 30);
  const qTrim = String(query || '').trim();
  const keywords = qTrim ? qTrim.split(/\s+/).filter(Boolean) : [];

  const jobs = await Job.find({
    isArchived: { $ne: true },
    isDeadEstimate: { $ne: true },
  })
    .populate('customerId', 'name')
    .select('title notes schedule customerId stage')
    .lean();

  const hits = [];

  for (const job of jobs) {
    const notes = Array.isArray(job.notes) ? job.notes : [];
    const crewNotes = job.schedule?.crewNotes ? String(job.schedule.crewNotes) : '';
    const jobId = String(job._id);
    const base = {
      jobId,
      jobTitle: job.title || 'Untitled',
      customerName: job.customerId?.name || null,
      stage: job.stage || null,
      path: `/customers?jobId=${jobId}`,
    };

    for (const note of notes) {
      const content = String(note.content || '').trim();
      if (!content) continue;
      if (!noteMatchesQuery(content, keywords)) continue;
      hits.push({
        ...base,
        noteDate: formatDate(note.createdAt),
        excerpt: content.slice(0, 450),
        author: note.createdByName || null,
        important: Boolean(note.important),
        kind: 'job_note',
      });
    }

    if (crewNotes && noteMatchesQuery(crewNotes, keywords)) {
      hits.push({
        ...base,
        noteDate: null,
        excerpt: crewNotes.slice(0, 450),
        author: null,
        important: false,
        kind: 'crew_notes',
      });
    }
  }

  hits.sort((a, b) => String(b.noteDate || '').localeCompare(String(a.noteDate || '')));

  return {
    query: qTrim || '(recent notes across active jobs)',
    matches: hits.slice(0, limit),
    totalMatches: hits.length,
    hint:
      keywords.length === 0
        ? 'No keywords provided — returned the most recent note excerpts. For ordering/materials questions, retry with keywords like "order", "material", "supply", "hardware", "cabinet".'
        : undefined,
  };
}

/**
 * Detailed job context: notes, payment schedule, recent timeline.
 */
async function fetchJobDetails({ jobId }) {
  const id = resolveJobId(jobId);
  if (!id) return { error: 'jobId is required' };

  const job = await Job.findById(id)
    .populate('customerId', 'name primaryPhone primaryEmail')
    .lean();
  if (!job) return { error: 'Job not found' };

  const activities = await Activity.find({ jobId: job._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const notes = [...(job.notes || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 25)
    .map((n) => ({
      date: formatDate(n.createdAt),
      content: String(n.content || '').slice(0, 600),
      important: Boolean(n.important),
      author: n.createdByName || null,
    }));

  const paymentSchedule = (job.paymentSchedule?.items || []).map((item) => ({
    label: item.label || null,
    dueType: item.dueType || null,
    status: item.status || 'pending',
    amount: formatMoney(item.amount),
    paidAmount: formatMoney(item.paidAmount),
    paidAt: formatDate(item.paidAt),
    dueNote: item.dueNote ? String(item.dueNote).slice(0, 200) : null,
  }));

  const recentActivities = activities.map((a) => ({
    type: a.type,
    date: formatDate(a.createdAt),
    amount: formatMoney(a.amount),
    note: a.note ? String(a.note).slice(0, 250) : null,
  }));

  return {
    jobId: String(job._id),
    title: job.title || 'Untitled',
    stage: job.stage || null,
    customerName: job.customerId?.name || null,
    customerPhone: job.customerId?.primaryPhone || null,
    description: job.description ? String(job.description).slice(0, 500) : null,
    crewNotes: job.schedule?.crewNotes ? String(job.schedule.crewNotes).slice(0, 500) : null,
    notes,
    paymentSchedule,
    recentActivities,
    path: `/customers?jobId=${job._id}`,
  };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatches(name, query) {
  const n = normalizeName(name);
  const q = normalizeName(query);
  if (!n || !q || q.length < 2) return false;
  if (n === q) return true;
  const nameParts = n.split(' ');
  const queryParts = q.split(' ');
  return queryParts.every((part) =>
    nameParts.some((piece) => piece === part || (part.length >= 3 && piece.startsWith(part))),
  );
}

function formatAddress(address) {
  if (!address || typeof address !== 'object') return '';
  return [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
}

function formatShopDay(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(dt);
}

function shopDayStart(daysFromToday = 0) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000));
  return new Date(`${ymd}T00:00:00-08:00`);
}

function collectPhones(customer, extraPhones = []) {
  const phones = [];
  const seen = new Set();
  const add = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const digits = value.replace(/\D/g, '');
    const key = digits.slice(-10) || value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    phones.push(value);
  };
  extraPhones.forEach(add);
  add(customer?.primaryPhone);
  (customer?.contactPhones || []).forEach((row) => add(row?.value));
  (customer?.phones || []).forEach(add);
  return phones;
}

function buildCustomerShareMessage(customer, job) {
  const phones = collectPhones(customer, [job?.jobContact?.phone]);
  const emails = [
    job?.jobContact?.email,
    customer?.primaryEmail,
    ...(customer?.contactEmails || []).map((row) => row?.value),
    ...(customer?.emails || []),
  ]
    .map((value) => String(value || '').trim())
    .filter((value, index, list) => value && list.indexOf(value) === index);
  const address = formatAddress(job?.jobAddress) || formatAddress(customer?.address);
  const gateCode = String(customer?.gateCode || '').trim();
  return [
    `Customer: ${customer?.name || 'Unknown'}`,
    job?.title ? `Job: ${job.title}` : null,
    phones.length ? `Phone: ${phones.join(', ')}` : null,
    emails.length ? `Email: ${emails.join(', ')}` : null,
    address ? `Address: ${address}` : null,
    gateCode ? `Gate code: ${gateCode}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function summarizeEmployee(row) {
  return {
    id: String(row._id),
    kind: row.kind,
    name: row.name || 'Unnamed',
  };
}

async function listRolodexEmployees() {
  const [users, contacts] = await Promise.all([
    User.find({ isPending: false, isActive: true }).select('name mobile').sort({ name: 1 }).lean(),
    EmployeeContact.find({}).select('name mobile').sort({ name: 1 }).lean(),
  ]);
  const employees = [
    ...users.map((u) => ({ ...u, kind: 'user' })),
    ...contacts.map((c) => ({ ...c, kind: 'contact' })),
  ]
    .filter((row) => String(row.mobile || '').trim())
    .map(summarizeEmployee);
  return { employees, count: employees.length };
}

function parseEmployeeQuery(query) {
  const q = normalizeName(query);
  let kind = null;
  if (/\b(users?|account|login)\b/.test(q)) kind = 'user';
  else if (/\b(contacts?|rolodex)\b/.test(q)) kind = 'contact';
  const name = q
    .replace(/\b(the\s+)?(users?|account|login|contacts?|rolodex)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name: name || q, kind };
}

function phoneKey(row) {
  const digits = String(row?.mobile || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return '';
}

function preferUser(a, b) {
  if (a?.kind === 'user' && b?.kind !== 'user') return a;
  if (b?.kind === 'user' && a?.kind !== 'user') return b;
  return a || b;
}

function collapseDuplicatePeople(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = phoneKey(row) || `name:${normalizeName(row.name)}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? preferUser(existing, row) : row);
  }
  const collapsed = [...byKey.values()];
  const byName = new Map();
  for (const row of collapsed) {
    const key = normalizeName(row.name);
    const existing = byName.get(key);
    byName.set(key, existing ? preferUser(existing, row) : row);
  }
  return [...byName.values()];
}

function matchEmployees(rows, query) {
  const { name, kind } = parseEmployeeQuery(query);
  let hits = collapseDuplicatePeople(rows.filter((row) => nameMatches(row.name, name)));
  if (kind) {
    const kindHits = hits.filter((row) => row.kind === kind);
    if (kindHits.length) hits = kindHits;
  }
  if (hits.length > 1) {
    const names = new Set(hits.map((row) => normalizeName(row.name)));
    if (names.size === 1) {
      const userHit = hits.find((row) => row.kind === 'user');
      hits = [userHit || hits[0]];
    }
  }
  return hits;
}

async function loadRolodexWithMobiles() {
  const [users, contacts] = await Promise.all([
    User.find({ isPending: false, isActive: true }).select('name mobile').lean(),
    EmployeeContact.find({}).select('name mobile').lean(),
  ]);
  return [
    ...users.map((u) => ({ ...u, kind: 'user' })),
    ...contacts.map((c) => ({ ...c, kind: 'contact' })),
  ].filter((row) => String(row.mobile || '').trim());
}

async function searchJobs({ query, limit: limitArg = 8 } = {}) {
  const qTrim = String(query || '').trim();
  const limit = clampLimit(limitArg, 8, 15);
  if (!qTrim) return { jobs: [], hint: 'Need a place, customer, or job name.' };

  const regex = new RegExp(escapeRegex(qTrim), 'i');
  const customers = await Customer.find({
    $or: [
      { name: regex },
      { 'address.city': regex },
      { 'address.street': regex },
      { 'address.zip': regex },
      { 'addresses.city': regex },
      { 'addresses.street': regex },
    ],
  })
    .select('_id name address')
    .limit(20)
    .lean();

  const jobs = await Job.find({
    isArchived: { $ne: true },
    isDeadEstimate: { $ne: true },
    isCompletedClosedOut: { $ne: true },
    stage: { $ne: 'FINAL_PAYMENT_CLOSED' },
    $or: [
      { title: regex },
      { 'jobAddress.city': regex },
      { 'jobAddress.street': regex },
      { 'jobAddress.zip': regex },
      { customerId: { $in: customers.map((c) => c._id) } },
    ],
  })
    .populate('customerId', 'name address primaryPhone')
    .select('title stage jobAddress schedule customerId updatedAt')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return {
    query: qTrim,
    jobs: jobs.map((job) => ({
      jobId: String(job._id),
      title: job.title || 'Untitled',
      stage: job.stage || null,
      customerName: job.customerId?.name || null,
      city: job.jobAddress?.city || job.customerId?.address?.city || null,
      address: formatAddress(job.jobAddress) || formatAddress(job.customerId?.address) || null,
      startDate: formatDate(job.schedule?.startDate),
      path: `/pipeline?jobId=${job._id}`,
    })),
  };
}

const MAP_STAGE_ALIASES = {
  'appointment scheduled': 'APPOINTMENT_SCHEDULED',
  'estimate in progress': 'ESTIMATE_IN_PROGRESS',
  'estimate sent': 'ESTIMATE_SENT',
  'design review': 'ENGAGED_DESIGN_REVIEW',
  'contract out': 'CONTRACT_OUT',
  'contract signed': 'CONTRACT_SIGNED',
  'deposit pending': 'DEPOSIT_PENDING',
  'signed': 'DEPOSIT_PENDING',
  'job prep': 'JOB_PREP',
  'fabrication': 'TAKEOFF_COMPLETE',
  'takeoff complete': 'TAKEOFF_COMPLETE',
  'ready to schedule': 'READY_TO_SCHEDULE',
  scheduled: 'SCHEDULED',
  'in production': 'IN_PRODUCTION',
  installed: 'INSTALLED',
  'final payment closed': 'FINAL_PAYMENT_CLOSED',
};

const MAP_SCHEDULED_STAGES = new Set([
  'SCHEDULED',
  'IN_PRODUCTION',
  'INSTALLED',
  'FINAL_PAYMENT_CLOSED',
]);

const MAP_ESTIMATE_STAGES = new Set([
  'APPOINTMENT_SCHEDULED',
  'ESTIMATE_IN_PROGRESS',
  'ESTIMATE_SENT',
  'ENGAGED_DESIGN_REVIEW',
  'CONTRACT_OUT',
]);

const CITY_ALIASES = {
  'dana pt': 'dana point',
  'sj clemente': 'san clemente',
  's clemente': 'san clemente',
};

function normalizePlace(value) {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/\bcalifornia\b|\bca\b/g, ' ')
    .replace(/\bpt\.?\b/g, 'point')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CITY_ALIASES[cleaned] || cleaned;
}

function placeMatch(hay, needle) {
  const a = normalizePlace(hay);
  const b = normalizePlace(needle);
  if (!a || !b) return false;
  return a === b || (` ${a} `).includes(` ${b} `);
}

function resolveMapStage(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^[A-Z_]+$/.test(text) && MAP_STAGE_ALIASES[text.toLowerCase().replace(/_/g, ' ')]) {
    return text;
  }
  const key = normalizePlace(text).replace(/\s+/g, ' ');
  return MAP_STAGE_ALIASES[key] || (Object.prototype.hasOwnProperty.call(MAP_STAGE_ALIASES, text.toLowerCase())
    ? MAP_STAGE_ALIASES[text.toLowerCase()]
    : text.toUpperCase().replace(/\s+/g, '_'));
}

function mapJobAmount(job) {
  const contracted = Number(job.valueContracted);
  if (Number.isFinite(contracted) && contracted > 0) return contracted;
  const estimated = Number(job.valueEstimated);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  return 0;
}

function mapJobCity(job) {
  const fromJob = String(job.jobAddress?.city || '').trim();
  if (fromJob) return fromJob;
  return String(job.customerId?.address?.city || '').trim();
}

function mapPagePath(pagePath) {
  const path = String(pagePath || '');
  if (['/dashboard-view', '/pipeline-view', '/calendar-view', '/customers-view'].some((root) =>
    path === root || path.startsWith(`${root}/`),
  )) {
    return '/dashboard-view';
  }
  return '/dashboard';
}

function parseNearPlace({ city, near, radiusMiles }) {
  const nearRaw = String(near || '').trim();
  const cityRaw = String(city || '').trim();
  const nearFromCity = /^(near|around|close to)\s+/i.test(cityRaw);
  const nearPlace = nearRaw || (nearFromCity ? cityRaw.replace(/^(near|around|close to)\s+/i, '').trim() : '');
  const exactCity = nearPlace ? '' : cityRaw.replace(/^(in|at)\s+/i, '').trim();
  const radius = Number(radiusMiles);
  return {
    city: exactCity,
    near: nearPlace,
    radiusMiles: Number.isFinite(radius) && radius > 0 ? Math.min(Math.max(radius, 1), 50) : 10,
    center: nearPlace ? lookupCityCenter(nearPlace) : null,
  };
}

async function showJobsOnMap({
  city,
  near,
  radiusMiles,
  query,
  stage,
  scheduled,
  minAmount,
  maxAmount,
  view,
  pagePath,
  limit: limitArg = 8,
} = {}) {
  const place = parseNearPlace({ city, near, radiusMiles });
  const limit = place.center ? 24 : clampLimit(limitArg, 8, 12);
  let cityQ = place.city;
  const nearQ = place.near;
  const radiusQ = place.radiusMiles;
  const center = place.center;
  if (nearQ && !center) cityQ = nearQ;
  const textQ = String(query || '').trim();
  const stageQ = resolveMapStage(stage);
  const scheduledQ = String(scheduled || 'any').toLowerCase();
  const min = Number(minAmount);
  const max = Number(maxAmount);
  const viewQ = ['pipeline', 'current', 'week', 'completed', 'archived'].includes(String(view || ''))
    ? String(view)
    : 'pipeline';

  const jobs = await Job.find({
    isDeadEstimate: { $ne: true },
    ...(viewQ === 'archived' ? { isArchived: true } : { isArchived: { $ne: true } }),
    ...(viewQ === 'completed'
      ? { isCompletedClosedOut: true }
      : viewQ === 'archived'
        ? {}
        : {
            isCompletedClosedOut: { $ne: true },
            stage: {
              $in: [
                'DEPOSIT_PENDING',
                'JOB_PREP',
                'TAKEOFF_COMPLETE',
                'READY_TO_SCHEDULE',
                'SCHEDULED',
                'IN_PRODUCTION',
                'INSTALLED',
                'CONTRACT_SIGNED',
              ],
            },
          }),
  })
    .populate('customerId', 'name address')
    .select('title stage jobAddress geo schedule customerId valueContracted valueEstimated isArchived isCompletedClosedOut')
    .sort({ updatedAt: -1 })
    .limit(center ? 400 : 80)
    .lean();

  const filtered = jobs.filter((job) => {
    if (viewQ !== 'archived' && MAP_ESTIMATE_STAGES.has(String(job.stage || ''))) return false;
    const address = formatJobLocation(job);
    const jobCity = mapJobCity(job);
    const hay = [job.title, job.customerId?.name, jobCity, address].filter(Boolean).join(' ');
    if (textQ && !new RegExp(escapeRegex(textQ), 'i').test(hay)) return false;
    if (cityQ && !placeMatch(`${jobCity} ${address}`, cityQ)) return false;
    if (stageQ && String(job.stage || '') !== stageQ) return false;
    const isScheduled = MAP_SCHEDULED_STAGES.has(String(job.stage || '')) || Boolean(job.isCompletedClosedOut);
    if (scheduledQ === 'yes' && !isScheduled) return false;
    if (scheduledQ === 'no' && isScheduled) return false;
    const amount = mapJobAmount(job);
    if (Number.isFinite(min) && min > 0 && amount < min) return false;
    if (Number.isFinite(max) && max > 0 && amount > max) return false;
    if (center) {
      const lat = Number(job.geo?.lat);
      const lng = Number(job.geo?.lng);
      const hasCoords = job.geo?.status === 'ok' && Number.isFinite(lat) && Number.isFinite(lng);
      if (hasCoords) return milesBetween(center.lat, center.lng, lat, lng) <= radiusQ;
      return placeMatch(`${jobCity} ${address}`, nearQ);
    }
    return true;
  });

  const mapped = [];
  const unmapped = [];
  for (const job of filtered) {
    const address = formatJobLocation(job);
    const lat = Number(job.geo?.lat);
    const lng = Number(job.geo?.lng);
    const hasCoords = job.geo?.status === 'ok' && Number.isFinite(lat) && Number.isFinite(lng);
    const onMap = hasCoords && (center || inOrangeCounty(lat, lng));
    const row = {
      id: String(job._id),
      title: job.title || 'Untitled',
      customerName: job.customerId?.name || null,
      city: mapJobCity(job) || null,
      amount: formatMoney(mapJobAmount(job)),
      stage: job.stage || null,
      scheduled: MAP_SCHEDULED_STAGES.has(String(job.stage || '')) || Boolean(job.isCompletedClosedOut),
      address: address || null,
      mapped: onMap,
      lat: onMap ? lat : null,
      lng: onMap ? lng : null,
      distanceMiles: onMap && center ? Number(milesBetween(center.lat, center.lng, lat, lng).toFixed(1)) : null,
    };
    if (onMap) mapped.push(row);
    else unmapped.push(row);
  }

  if (center) {
    mapped.sort((a, b) => (a.distanceMiles || 0) - (b.distanceMiles || 0));
  }
  const limitedMapped = mapped.slice(0, limit);
  const limitedUnmapped = unmapped.slice(0, Math.max(0, limit - limitedMapped.length));

  return {
    filters: {
      query: textQ || undefined,
      city: cityQ || undefined,
      near: center ? nearQ : undefined,
      radiusMiles: center ? radiusQ : undefined,
      stage: stageQ || undefined,
      scheduled: scheduledQ === 'yes' || scheduledQ === 'no' ? scheduledQ : 'any',
      minAmount: Number.isFinite(min) && min > 0 ? min : undefined,
      maxAmount: Number.isFinite(max) && max > 0 ? max : undefined,
      view: viewQ,
    },
    path: mapPagePath(pagePath),
    count: limitedMapped.length + limitedUnmapped.length,
    mappedCount: limitedMapped.length,
    unmappedCount: limitedUnmapped.length,
    jobs: [...limitedMapped, ...limitedUnmapped],
  };
}

async function fetchUpcomingSchedule({ days: daysArg = 14, limit: limitArg = 12 } = {}) {
  const days = clampLimit(daysArg, 14, 30);
  const limit = clampLimit(limitArg, 12, 20);
  const start = shopDayStart(0);
  const end = new Date(shopDayStart(days).getTime() + 24 * 60 * 60 * 1000 - 1);

  const [appointments, datedJobs] = await Promise.all([
    Appointment.find({
      status: 'scheduled',
      date: { $gte: start, $lte: end },
    })
      .populate('customerId', 'name')
      .populate('jobId', 'title')
      .sort({ date: 1, time: 1 })
      .limit(limit)
      .lean(),
    Job.find({
      isArchived: { $ne: true },
      isDeadEstimate: { $ne: true },
      $or: [
        { 'schedule.startDate': { $gte: start, $lte: end } },
        { 'schedule.endDate': { $gte: start, $lte: end } },
        { 'schedule.entries.startDate': { $gte: start, $lte: end } },
      ],
    })
      .populate('customerId', 'name')
      .select('title stage schedule customerId')
      .sort({ 'schedule.startDate': 1 })
      .limit(limit)
      .lean(),
  ]);

  return {
    rangeDays: days,
    appointments: appointments.map((row) => ({
      title: row.title || 'Appointment',
      date: formatShopDay(row.date),
      time: row.time || null,
      customerName: row.customerId?.name || row.customerName || null,
      location: row.location || null,
      jobTitle: row.jobId?.title || null,
    })),
    jobsOnCalendar: datedJobs.map((job) => ({
      jobId: String(job._id),
      title: job.title || 'Untitled',
      customerName: job.customerId?.name || null,
      startDate: formatShopDay(job.schedule?.startDate),
      endDate: formatShopDay(job.schedule?.endDate),
      installers: [
        ...(Array.isArray(job.schedule?.installers) ? job.schedule.installers : []),
        job.schedule?.installer,
      ].filter(Boolean),
      path: `/calendar-view`,
    })),
  };
}

async function sendCustomerInfoText({ customerQuery, employeeQuery, createdBy, tenantId }) {
  const customerQ = String(customerQuery || '').trim();
  const employeeQ = String(employeeQuery || '').trim();
  if (!customerQ || !employeeQ) {
    return { sent: false, error: 'Need both a customer/job name and an employee name.' };
  }

  const rolodex = await loadRolodexWithMobiles();
  const employeeHits = matchEmployees(rolodex, employeeQ);
  if (!employeeHits.length) {
    return {
      sent: false,
      error: `No rolodex match with a mobile number for "${employeeQ}".`,
      employees: (await listRolodexEmployees()).employees.slice(0, 20),
    };
  }
  if (employeeHits.length > 1) {
    return {
      sent: false,
      error: `Several people match "${employeeQ}". Ask which one.`,
      matches: employeeHits.slice(0, 8).map(summarizeEmployee),
    };
  }

  const regex = new RegExp(escapeRegex(customerQ), 'i');
  const customers = await Customer.find({ name: regex })
    .limit(8)
    .lean();
  const jobs = await Job.find({
    isArchived: { $ne: true },
    isDeadEstimate: { $ne: true },
    $or: [{ title: regex }, { customerId: { $in: customers.map((c) => c._id) } }],
  })
    .populate('customerId')
    .sort({ updatedAt: -1 })
    .limit(8)
    .lean();

  const customerIds = new Set();
  jobs.forEach((job) => {
    const id = job.customerId?._id || job.customerId;
    if (id) customerIds.add(String(id));
  });
  customers.forEach((c) => customerIds.add(String(c._id)));

  if (!customerIds.size) {
    return { sent: false, error: `I couldn't find a customer or job matching "${customerQ}".` };
  }
  if (customerIds.size > 1) {
    const names = [
      ...jobs.map((job) => job.customerId?.name || job.title),
      ...customers.map((c) => c.name),
    ].filter(Boolean);
    return {
      sent: false,
      error: `Several customers match "${customerQ}". Ask which one.`,
      matches: [...new Set(names)].slice(0, 8),
    };
  }

  const job = jobs[0] || null;
  const customer = job?.customerId && typeof job.customerId === 'object'
    ? job.customerId
    : customers[0];
  if (!customer) {
    return { sent: false, error: `I couldn't load customer details for "${customerQ}".` };
  }

  const employee = employeeHits[0];
  const message = buildCustomerShareMessage(customer, job);
  const { sendResolvedEmployeeSms } = require('../controllers/twilioController');
  const payload =
    employee.kind === 'contact'
      ? { employeeContactId: String(employee._id), message, createdBy, tenantId }
      : { employeeUserId: String(employee._id), message, createdBy, tenantId };

  const result = await sendResolvedEmployeeSms(payload);
  return {
    sent: true,
    toName: employee.name,
    customerName: customer.name,
    jobTitle: job?.title || null,
    preview: message,
    twilioStatus: result?.status || null,
  };
}

function mobileDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function toE164(value) {
  const digits = mobileDigits(value);
  return digits.length === 10 ? `+1${digits}` : '';
}

function formatShopTime(date) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: SHOP_TIMEZONE,
  });
}

function formatShopDay(date) {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: SHOP_TIMEZONE,
  });
}

async function createShopTask({ title, createdBy }) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { error: 'Need a task title.' };
  if (!createdBy) return { error: 'Need a signed-in user.' };
  const task = await Task.create({
    title: clean.slice(0, 200),
    type: 'follow_up',
    assignedTo: createdBy,
    createdBy,
  });
  return { ok: true, taskId: String(task._id), title: task.title };
}

async function lookupStoredPhone({ phone, me, user } = {}) {
  if (me) {
    const mine = toE164(user?.mobile);
    if (!mine) return { found: false, reason: 'no_mobile' };
    return { found: true, name: user?.name || 'you', mobile: mine, me: true };
  }
  const digits = mobileDigits(phone);
  if (digits.length !== 10) return { found: false, reason: 'invalid' };
  const rows = await loadRolodexWithMobiles();
  const hit = rows.find((row) => mobileDigits(row.mobile) === digits);
  if (!hit) return { found: false, reason: 'not_stored', digits };
  return {
    found: true,
    name: hit.name || 'that person',
    mobile: toE164(hit.mobile),
  };
}

async function scheduleReminderText({ to, message, sendAt, createdBy }) {
  const e164 = toE164(to);
  const body = String(message || '').replace(/\s+/g, ' ').trim();
  const when = sendAt ? new Date(sendAt) : null;
  if (!e164) return { error: 'Need a stored mobile number.' };
  if (!body) return { error: 'Need a reminder message.' };
  if (!when || Number.isNaN(when.getTime())) return { error: 'Need a send time.' };
  if (when.getTime() <= Date.now()) return { error: 'That time already passed.' };
  const stored = await lookupStoredPhone({ phone: e164 });
  if (!stored.found) return { error: 'That number is not on file.', found: false };
  const sms = await ScheduledSms.create({
    to: stored.mobile,
    message: body.slice(0, 400),
    sendAt: when,
    createdBy: createdBy || undefined,
    status: 'scheduled',
  });
  return {
    ok: true,
    id: String(sms._id),
    to: stored.mobile,
    name: stored.name,
    sendAt: sms.sendAt,
    dayLabel: formatShopDay(when),
    timeLabel: formatShopTime(when),
  };
}

async function createShopAppointment({ title, date, time, customerQuery, createdBy }) {
  const spoken = String(title || customerQuery || '').replace(/\s+/g, ' ').trim();
  if (!spoken) return { error: 'Need a name or appointment title.' };
  if (!createdBy) return { error: 'Need a signed-in user.' };
  const when = date ? new Date(date) : null;
  if (!when || Number.isNaN(when.getTime())) return { error: 'Need a date and time.' };
  if (when.getTime() <= Date.now() - 60 * 1000) return { error: 'That time already passed.' };
  const timeLabel = String(time || '').trim() || formatShopTime(when);
  const regex = new RegExp(escapeRegex(spoken), 'i');
  const customer = await Customer.findOne({ name: regex }).select('_id name').lean();
  const appointment = await Appointment.create({
    title: (customer?.name || spoken).slice(0, 200),
    date: when,
    time: timeLabel,
    customerId: customer?._id,
    customerName: customer?.name || spoken,
    status: 'scheduled',
    createdBy,
  });
  return {
    ok: true,
    appointmentId: String(appointment._id),
    title: appointment.title,
    customerName: appointment.customerName,
    dayLabel: formatShopDay(when),
    timeLabel,
  };
}

module.exports = {
  fetchRecentPayments,
  fetchRecentDeposits,
  searchJobNotes,
  fetchJobDetails,
  searchJobs,
  showJobsOnMap,
  fetchUpcomingSchedule,
  listRolodexEmployees,
  sendCustomerInfoText,
  createShopTask,
  lookupStoredPhone,
  scheduleReminderText,
  createShopAppointment,
};
