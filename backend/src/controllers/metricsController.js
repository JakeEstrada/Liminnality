const Job = require('../models/Job');
const Tenant = require('../models/Tenant');
const WebsiteAnalyticsEvent = require('../models/WebsiteAnalyticsEvent');
const { roundMoney } = require('../utils/paymentSchedule');
const { AD_CHANNEL_IDS, buildSalesMetrics } = require('../utils/salesMetrics');

const JOB_FIELDS = 'createdAt stage source valueContracted valueEstimated changeOrders paymentSchedule isDeadEstimate';
const ADS_QUERY = { $regex: 'gclid=|gbraid=|wbraid=', $options: 'i' };

function tenantIdOf(req) {
  const id = req.user?.tenantId;
  return id ? String(id) : '';
}

async function googleAdsForYear(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const match = {
    occurredAt: { $gte: start, $lt: end },
    query: ADS_QUERY,
  };
  const [adClicks, contactSubmits] = await Promise.all([
    WebsiteAnalyticsEvent.countDocuments({ ...match, type: 'page_view' }),
    WebsiteAnalyticsEvent.countDocuments({ ...match, type: 'contact_submit' }),
  ]);
  return { adClicks, contactSubmits };
}

async function getMetrics(req, res) {
  try {
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    const [jobs, tenant, googleAds] = await Promise.all([
      Job.find({}).select(JOB_FIELDS).lean(),
      Tenant.findById(tenantId).select('adSpend').lean(),
      googleAdsForYear(year),
    ]);
    res.json(buildSalesMetrics({
      jobs: jobs || [],
      year,
      now,
      adSpend: tenant?.adSpend || [],
      googleAds,
    }));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load metrics' });
  }
}

function readSpend(body) {
  const channel = String(body?.channel || '').trim();
  const month = String(body?.month || '').trim();
  const amount = roundMoney(Number(body?.amount));
  const note = String(body?.note || '').trim().slice(0, 200);
  if (!AD_CHANNEL_IDS.has(channel)) return { error: 'Choose an advertising channel' };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'Month must look like 2026-11' };
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return { error: 'Enter a spend amount' };
  return { channel, month, amount, note };
}

async function saveAdSpend(req, res) {
  try {
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });
    const parsed = readSpend(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Company not found' });
    if (!Array.isArray(tenant.adSpend)) tenant.adSpend = [];
    const existing = tenant.adSpend.find((row) => row.month === parsed.month && row.channel === parsed.channel);
    if (existing) {
      existing.amount = parsed.amount;
      existing.note = parsed.note;
    } else {
      tenant.adSpend.push(parsed);
    }
    tenant.markModified('adSpend');
    await tenant.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save advertising spend' });
  }
}

async function deleteAdSpend(req, res) {
  try {
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Company not found' });
    const id = String(req.params.id || '');
    tenant.adSpend = (tenant.adSpend || []).filter((row) => String(row._id) !== id);
    tenant.markModified('adSpend');
    await tenant.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to remove advertising spend' });
  }
}

module.exports = { getMetrics, saveAdSpend, deleteAdSpend };
