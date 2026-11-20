const {
  roundMoney,
  getJobPaymentSummary,
  getScheduleItemTotal,
  resolvePaymentSchedule,
} = require('./paymentSchedule');

const BASELINE_ANNUAL_SALES = 800000;

const AD_CHANNELS = [
  { id: 'google', label: 'Google Ads', jobSource: null },
  { id: 'website', label: 'Website', jobSource: 'website' },
  { id: 'facebook', label: 'Facebook', jobSource: 'facebook' },
  { id: 'instagram', label: 'Instagram', jobSource: 'instagram' },
  { id: 'yelp', label: 'Yelp', jobSource: 'yelp' },
  { id: 'vehicle_advertisement', label: 'Vehicle advertisement', jobSource: 'vehicle_advertisement' },
];

const OTHER_SOURCES = [
  { id: 'referral', label: 'Referral' },
  { id: 'repeat', label: 'Repeat customer' },
  { id: 'other', label: 'Other' },
];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Jobs in these stages have left the estimate and count as booked sales. */
const SOLD_STAGES = new Set([
  'DEPOSIT_PENDING',
  'JOB_PREP',
  'TAKEOFF_COMPLETE',
  'READY_TO_SCHEDULE',
  'SCHEDULED',
  'IN_PRODUCTION',
  'INSTALLED',
  'FINAL_PAYMENT_CLOSED',
]);

const AD_CHANNEL_IDS = new Set(AD_CHANNELS.map((row) => row.id));

function paidLineAmount(item, scheduledTotal) {
  if (item?.status !== 'paid') return 0;
  const scheduled = roundMoney(scheduledTotal);
  const rawPaid = roundMoney(Number(item?.paidAmount) || scheduled);
  if (rawPaid > scheduled + 0.01) return scheduled;
  return rawPaid;
}

function inRange(value, start, end) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return date >= start && date < end;
}

function yearBounds(year) {
  return {
    start: new Date(year, 0, 1),
    end: new Date(year + 1, 0, 1),
  };
}

function sourceOf(job) {
  const value = String(job?.source || 'other').trim();
  return value || 'other';
}

function collectedLines(job) {
  const summary = getJobPaymentSummary(job);
  const schedule = resolvePaymentSchedule(job);
  const lines = [];
  for (const item of schedule.items || []) {
    const scheduledTotal = getScheduleItemTotal(item, summary.base, summary.coAddedToFinal);
    const amount = paidLineAmount(item, scheduledTotal);
    if (amount <= 0) continue;
    lines.push({ amount, at: item.paidAt || job.createdAt });
  }
  for (const row of Array.isArray(job?.changeOrders) ? job.changeOrders : []) {
    if (row?.status !== 'paid') continue;
    if (String(row.billing || 'separate') !== 'separate') continue;
    const amount = roundMoney(Number(row.paidAmount) || Number(row.amount) || 0);
    if (amount <= 0) continue;
    lines.push({ amount, at: row.paidAt || row.createdAt || job.createdAt });
  }
  return lines;
}

function compareToBaseline(amount, { year, now }) {
  const { start, end } = yearBounds(year);
  const currentYear = now.getFullYear() === year;
  const fraction = currentYear
    ? Math.min(1, Math.max((now.getTime() - start.getTime()) / (end.getTime() - start.getTime()), 0))
    : 1;
  const baselineToDate = roundMoney(BASELINE_ANNUAL_SALES * fraction);
  const delta = roundMoney(amount - baselineToDate);
  const deltaPct = baselineToDate > 0 ? roundMoney((delta / baselineToDate) * 100) : 0;
  const pace = fraction > 0 ? roundMoney(amount / fraction) : 0;
  const paceDelta = roundMoney(pace - BASELINE_ANNUAL_SALES);
  const pacePct = roundMoney((paceDelta / BASELINE_ANNUAL_SALES) * 100);
  return {
    amount: roundMoney(amount),
    baselineToDate,
    delta,
    deltaPct,
    pace,
    paceDelta,
    pacePct,
  };
}

function buildSalesMetrics({ jobs, year, now, adSpend = [], googleAds = {} }) {
  const list = Array.isArray(jobs) ? jobs : [];
  const { start, end } = yearBounds(year);
  const monthly = MONTH_LABELS.map((label, index) => ({
    month: `${year}-${String(index + 1).padStart(2, '0')}`,
    label,
    booked: 0,
    collected: 0,
    baseline: roundMoney(BASELINE_ANNUAL_SALES / 12),
  }));

  let booked = 0;
  let bookedJobs = 0;
  let openEstimates = 0;
  let openEstimateCount = 0;
  let collected = 0;
  const bySource = new Map();

  function bump(source, field, amount) {
    const row = bySource.get(source) || { jobs: 0, booked: 0, collected: 0 };
    row[field] = roundMoney(row[field] + amount);
    bySource.set(source, row);
  }

  for (const job of list) {
    const created = job?.createdAt;
    const source = sourceOf(job);
    if (!job?.isDeadEstimate && inRange(created, start, end)) {
      const total = getJobPaymentSummary(job).jobTotal;
      if (total > 0 && SOLD_STAGES.has(String(job.stage || ''))) {
        booked += total;
        bookedJobs += 1;
        const month = new Date(created).getMonth();
        monthly[month].booked = roundMoney(monthly[month].booked + total);
        bump(source, 'booked', total);
        bump(source, 'jobs', 1);
      } else if (total > 0) {
        openEstimates += total;
        openEstimateCount += 1;
      }
    }
    for (const line of collectedLines(job)) {
      if (!inRange(line.at, start, end)) continue;
      collected += line.amount;
      const month = new Date(line.at).getMonth();
      monthly[month].collected = roundMoney(monthly[month].collected + line.amount);
      bump(source, 'collected', line.amount);
    }
  }

  const spendByChannel = new Map();
  const spendRows = (Array.isArray(adSpend) ? adSpend : [])
    .filter((row) => String(row?.month || '').startsWith(`${year}-`))
    .map((row) => ({
      id: String(row._id || row.id || ''),
      month: String(row.month),
      channel: String(row.channel),
      amount: roundMoney(Number(row.amount) || 0),
      note: String(row.note || ''),
    }));
  for (const row of spendRows) {
    spendByChannel.set(row.channel, roundMoney((spendByChannel.get(row.channel) || 0) + row.amount));
  }

  const advertising = AD_CHANNELS.map((channel) => {
    const stats = channel.jobSource ? bySource.get(channel.jobSource) || { jobs: 0, booked: 0, collected: 0 } : { jobs: 0, booked: 0, collected: 0 };
    const spend = spendByChannel.get(channel.id) || 0;
    const clicks = channel.id === 'google' ? Number(googleAds.adClicks) || 0 : 0;
    return {
      id: channel.id,
      label: channel.label,
      jobs: stats.jobs,
      booked: roundMoney(stats.booked),
      collected: roundMoney(stats.collected),
      spend,
      returnPerDollar: spend > 0 ? roundMoney(stats.booked / spend) : null,
      costPerJob: spend > 0 && stats.jobs > 0 ? roundMoney(spend / stats.jobs) : null,
      adClicks: clicks,
      contactSubmits: channel.id === 'google' ? Number(googleAds.contactSubmits) || 0 : 0,
      costPerClick: spend > 0 && clicks > 0 ? roundMoney(spend / clicks) : null,
    };
  });

  const otherSources = OTHER_SOURCES.map((source) => {
    const stats = bySource.get(source.id) || { jobs: 0, booked: 0, collected: 0 };
    return {
      id: source.id,
      label: source.label,
      jobs: stats.jobs,
      booked: roundMoney(stats.booked),
      collected: roundMoney(stats.collected),
    };
  });

  const years = new Set([now.getFullYear(), year]);
  for (const job of list) {
    const created = job?.createdAt ? new Date(job.createdAt) : null;
    if (created && !Number.isNaN(created.getTime())) years.add(created.getFullYear());
  }

  return {
    year,
    baselineAnnual: BASELINE_ANNUAL_SALES,
    asOf: now.toISOString(),
    booked: { ...compareToBaseline(booked, { year, now }), jobCount: bookedJobs },
    openEstimates: { amount: roundMoney(openEstimates), jobCount: openEstimateCount },
    collected: compareToBaseline(collected, { year, now }),
    monthly: monthly.map((row) => ({
      ...row,
      booked: roundMoney(row.booked),
      collected: roundMoney(row.collected),
    })),
    advertising,
    otherSources,
    adSpend: spendRows.sort((a, b) => a.month.localeCompare(b.month) || a.channel.localeCompare(b.channel)),
    years: [...years].sort((a, b) => b - a),
  };
}

module.exports = {
  BASELINE_ANNUAL_SALES,
  AD_CHANNELS,
  AD_CHANNEL_IDS,
  buildSalesMetrics,
};
