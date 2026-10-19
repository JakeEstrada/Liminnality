function formatAddressParts(parts: unknown[]): string {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

function formatAddressLike(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object') return '';
  const addr = value as {
    fullAddress?: unknown;
    street?: unknown;
    line1?: unknown;
    address1?: unknown;
    city?: unknown;
    state?: unknown;
    zip?: unknown;
    postalCode?: unknown;
  };
  const full = String(addr.fullAddress || '').trim();
  if (full) return full;
  return formatAddressParts([
    addr.street || addr.line1 || addr.address1,
    addr.city,
    addr.state,
    addr.zip || addr.postalCode,
  ]);
}

export function jobSiteAddress(job: Record<string, unknown> | null | undefined): string {
  if (!job) return '';
  const fromJob = formatAddressLike(job.jobAddress);
  if (fromJob) return fromJob;

  const customer =
    job.customerId && typeof job.customerId === 'object'
      ? (job.customerId as {
          address?: unknown;
          addresses?: unknown[];
        })
      : null;
  const fromCustomer = formatAddressLike(customer?.address);
  if (fromCustomer) return fromCustomer;

  const extras = Array.isArray(customer?.addresses) ? customer.addresses : [];
  for (const extra of extras) {
    const line = formatAddressLike(extra);
    if (line) return line;
  }

  const geo = job.geo as { sourceAddress?: unknown } | undefined;
  return String(geo?.sourceAddress || '').trim();
}

export function jobHasMapPin(job: Record<string, unknown> | null | undefined): boolean {
  const geo = job?.geo as { status?: string; lat?: number; lng?: number } | undefined;
  const lat = Number(geo?.lat);
  const lng = Number(geo?.lng);
  return geo?.status === 'ok' && Number.isFinite(lat) && Number.isFinite(lng);
}

/** Live jobs that should be on the map but are not. */
export function jobNeedsMapFix(job: Record<string, unknown> | null | undefined): boolean {
  if (!job) return false;
  if (job.isArchived || job.isDeadEstimate || job.isCompletedClosedOut) return false;
  if (jobHasMapPin(job)) return false;
  const address = jobSiteAddress(job);
  const geo = job.geo as { status?: string } | undefined;
  return Boolean(address) || geo?.status === 'failed';
}

export function jobMapFixLabel(job: Record<string, unknown> | null | undefined): string {
  const address = jobSiteAddress(job);
  if (!address) return 'Not on the map — add a street address';
  return 'Not on the map — tap to correct the address';
}
