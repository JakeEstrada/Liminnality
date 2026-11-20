const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSalesMetrics, BASELINE_ANNUAL_SALES } = require('../src/utils/salesMetrics');

function job(overrides) {
  return {
    createdAt: '2026-03-15T12:00:00.000Z',
    source: 'website',
    stage: 'FINAL_PAYMENT_CLOSED',
    valueContracted: 10000,
    valueEstimated: 0,
    isDeadEstimate: false,
    changeOrders: [],
    paymentSchedule: { type: 'custom', items: [] },
    ...overrides,
  };
}

test('booked sales ignore dead estimates and compare with the 800k baseline', () => {
  const now = new Date('2026-07-02T12:00:00.000Z');
  const result = buildSalesMetrics({
    jobs: [
      job({ valueContracted: 400000 }),
      job({ valueContracted: 50000, isDeadEstimate: true }),
      job({ stage: 'ESTIMATE_SENT', valueContracted: 80000 }),
      job({ createdAt: '2025-06-01T12:00:00.000Z', valueContracted: 900000 }),
    ],
    year: 2026,
    now,
    adSpend: [],
  });

  assert.equal(result.baselineAnnual, BASELINE_ANNUAL_SALES);
  assert.equal(result.booked.amount, 400000);
  assert.equal(result.booked.jobCount, 1);
  assert.equal(result.openEstimates.amount, 80000);
  assert.equal(result.openEstimates.jobCount, 1);
  assert.ok(Math.abs(result.booked.baselineToDate - 400000) < 15000);
  assert.ok(Math.abs(result.booked.pace - 800000) < 30000);
});

test('collected money uses the paid date and separate change orders', () => {
  const now = new Date('2026-12-15T12:00:00.000Z');
  const result = buildSalesMetrics({
    jobs: [
      job({
        createdAt: '2025-01-01T12:00:00.000Z',
        source: 'facebook',
        valueContracted: 10000,
        paymentSchedule: {
          type: 'custom',
          items: [
            { label: 'Deposit', amountType: 'fixed', amount: 4000, status: 'paid', paidAmount: 4000, paidAt: '2026-02-01T12:00:00.000Z' },
            { label: 'Final', amountType: 'fixed', amount: 6000, status: 'pending', paidAmount: 0 },
          ],
        },
        changeOrders: [
          { description: 'Extra rail', amount: 500, billing: 'separate', status: 'paid', paidAmount: 500, paidAt: '2026-02-10T12:00:00.000Z' },
          { description: 'Rolled in', amount: 800, billing: 'final', status: 'paid', paidAmount: 800, paidAt: '2026-02-10T12:00:00.000Z' },
        ],
      }),
    ],
    year: 2026,
    now,
  });

  assert.equal(result.collected.amount, 4500);
  assert.equal(result.booked.amount, 0);
  const facebook = result.advertising.find((row) => row.id === 'facebook');
  assert.equal(facebook.collected, 4500);
  assert.equal(facebook.jobs, 0);
  assert.equal(result.monthly[1].collected, 4500);
});

test('advertising spend is totaled for the channel and year', () => {
  const now = new Date('2026-11-20T12:00:00.000Z');
  const result = buildSalesMetrics({
    jobs: [job({ valueContracted: 20000, source: 'yelp' })],
    year: 2026,
    now,
    adSpend: [
      { _id: 'a', month: '2026-03', channel: 'yelp', amount: 400, note: '' },
      { _id: 'b', month: '2026-04', channel: 'yelp', amount: 600, note: '' },
      { _id: 'c', month: '2025-04', channel: 'yelp', amount: 9000, note: '' },
    ],
    googleAds: { adClicks: 12, contactSubmits: 2 },
  });

  const yelp = result.advertising.find((row) => row.id === 'yelp');
  assert.equal(yelp.spend, 1000);
  assert.equal(yelp.booked, 20000);
  assert.equal(yelp.returnPerDollar, 20);
  assert.equal(yelp.costPerJob, 1000);
  const google = result.advertising.find((row) => row.id === 'google');
  assert.equal(google.adClicks, 12);
  assert.equal(google.contactSubmits, 2);
  assert.equal(google.jobs, 0);
});
