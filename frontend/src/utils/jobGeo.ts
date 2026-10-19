function formatAddressParts(parts: unknown[]): string {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

export function jobSiteAddress(job: Record<string, unknown> | null | undefined): string {
  if (!job) return '';
  const jobAddress = job.jobAddress as
    | { street?: string; city?: string; state?: string; zip?: string }
    | undefined;
  if (jobAddress && (jobAddress.street || jobAddress.city || jobAddress.state || jobAddress.zip)) {
    return formatAddressParts([jobAddress.street, jobAddress.city, jobAddress.state, jobAddress.zip]);
  }
  const customer =
    job.customerId && typeof job.customerId === 'object'
      ? (job.customerId as { address?: { street?: string; city?: string; state?: string; zip?: string } })
      : null;
  const customerAddress = customer?.address;
  if (
    customerAddress &&
    (customerAddress.street || customerAddress.city || customerAddress.state || customerAddress.zip)
  ) {
    return formatAddressParts([
      customerAddress.street,
      customerAddress.city,
      customerAddress.state,
      customerAddress.zip,
    ]);
  }
  return '';
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
