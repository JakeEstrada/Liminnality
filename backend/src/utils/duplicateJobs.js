function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lowercase, drop punctuation, and collapse spaces so "4632 E. Bradford" matches "4632 e bradford". */
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact customer-name match, ignoring case and extra spaces. */
function namePattern(name) {
  const parts = normalizeText(name).split(' ').filter(Boolean).map(escapeRegex);
  if (!parts.length) return null;
  return new RegExp(`^${parts.join('\\s+')}$`, 'i');
}

function customerOf(job) {
  if (job?.customer && typeof job.customer === 'object') return job.customer;
  if (job?.customerId && typeof job.customerId === 'object') return job.customerId;
  return null;
}

/** The site on the job wins. A job with no street falls back to the customer's saved address. */
function addressOf(job) {
  const jobAddress = job?.jobAddress || {};
  const customerAddress = customerOf(job)?.address || {};
  const source = normalizeText(jobAddress.street) ? jobAddress : customerAddress;
  return { street: source.street || '', city: source.city || '' };
}

function stateLabel(job) {
  if (job?.isArchived) return 'Archived';
  if (job?.isDeadEstimate) return 'Dead estimate';
  if (job?.isCompletedClosedOut) return 'Completed';
  const stage = String(job?.stage || '').trim();
  if (!stage) return 'On the pipeline';
  return stage
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Jobs whose customer name and street already match what is being entered.
 * A city on both sides must match too. A blank city still matches.
 */
function pickDuplicateJobs(jobs, entered) {
  const name = normalizeText(entered?.name);
  const street = normalizeText(entered?.street);
  const city = normalizeText(entered?.city);
  if (!name || !street) return [];

  const matches = [];
  for (const job of jobs || []) {
    const customer = customerOf(job);
    if (normalizeText(customer?.name) !== name) continue;
    const place = addressOf(job);
    if (normalizeText(place.street) !== street) continue;
    const existingCity = normalizeText(place.city);
    if (city && existingCity && city !== existingCity) continue;
    matches.push({
      id: String(job._id || job.id || ''),
      title: String(job.title || '').trim() || 'Untitled job',
      customerName: String(customer?.name || '').trim(),
      street: String(place.street || '').trim(),
      city: String(place.city || '').trim(),
      stateLabel: stateLabel(job),
    });
    if (matches.length === 5) break;
  }
  return matches;
}

module.exports = {
  namePattern,
  normalizeText,
  pickDuplicateJobs,
};
