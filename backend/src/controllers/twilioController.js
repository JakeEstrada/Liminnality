const ScheduledSms = require('../models/ScheduledSms');
const SmsMessage = require('../models/SmsMessage');
const Customer = require('../models/Customer');
const Job = require('../models/Job');
const Activity = require('../models/Activity');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { emitJobUpdated } = require('../services/jobRealtime');
const File = require('../models/File');
const crypto = require('crypto');
const { getFileStream } = require('./fileController');
const { ensureDefaultTenant, ensureTenantBySlug } = require('../utils/tenantService');
const { runWithTenantContext } = require('../middleware/tenantContext');
const { publishSmsInboundCreated } = require('../services/eventBus');
const { tryRecordSmsPunch, findActivePhoneByFrom } = require('./rfidController');
const { openStoredSmsMedia, storeSmsMediaBuffer } = require('../utils/smsMediaStore');

/**
 * Basic Twilio webhook handlers.
 * Twilio posts `application/x-www-form-urlencoded` payloads.
 */
function xmlResponse(res, xml) {
  res.set('Content-Type', 'text/xml');
  return res.status(200).send(xml);
}

function normalizeToE164(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : `+1${digits}`;
}

function phoneDigits(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function phoneMatchVariants(value) {
  const e164 = normalizeToE164(value);
  const digits = phoneDigits(e164 || value);
  const variants = new Set();
  if (e164) variants.add(e164);
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
    if (digits.length === 11 && digits.startsWith('1')) {
      variants.add(digits.slice(1));
      variants.add(`+${digits.slice(1)}`);
    }
    if (digits.length === 10) {
      variants.add(`1${digits}`);
      variants.add(`+1${digits}`);
    }
  }
  return [...variants].filter(Boolean);
}

function optionalObjectId(value) {
  const raw = String(value || '').trim();
  return /^[a-fA-F0-9]{24}$/.test(raw) ? raw : undefined;
}

function collectJobPhoneVariants(job) {
  const customer = job?.customerId && typeof job.customerId === 'object' ? job.customerId : null;
  const raw = [
    customer?.primaryPhone,
    ...(Array.isArray(customer?.phones) ? customer.phones : []),
    ...(Array.isArray(customer?.contactPhones) ? customer.contactPhones.map((row) => row?.value) : []),
    job?.jobContact?.phone,
  ];
  const variants = new Set();
  for (const value of raw) {
    for (const variant of phoneMatchVariants(value)) variants.add(variant);
  }
  return [...variants];
}

async function resolveSmsJobLinks({ from, to, direction, jobId, customerId } = {}) {
  let nextJobId = optionalObjectId(jobId);
  let nextCustomerId = optionalObjectId(customerId);
  const phone = direction === 'inbound' ? from : to;

  if (!nextCustomerId) {
    const variants = phoneMatchVariants(phone);
    if (variants.length) {
      const customer = await Customer.findOne({
        $or: [
          { primaryPhone: { $in: variants } },
          { phones: { $in: variants } },
          { 'contactPhones.value': { $in: variants } },
        ],
      })
        .select('_id')
        .lean();
      if (customer?._id) nextCustomerId = String(customer._id);
    }
  }

  if (!nextJobId) {
    const variants = phoneMatchVariants(phone);
    if (variants.length) {
      const prior = await SmsMessage.findOne({
        direction: 'outbound',
        jobId: { $exists: true, $ne: null },
        to: { $in: variants },
      })
        .sort({ createdAt: -1 })
        .select('jobId customerId')
        .lean();
      if (prior?.jobId) {
        nextJobId = String(prior.jobId);
        if (!nextCustomerId && prior.customerId) nextCustomerId = String(prior.customerId);
      }
    }
  }

  if (!nextJobId && nextCustomerId) {
    const job = await Job.findOne({
      customerId: nextCustomerId,
      isArchived: { $ne: true },
    })
      .sort({ updatedAt: -1 })
      .select('_id customerId')
      .lean();
    if (job?._id) nextJobId = String(job._id);
  }

  return {
    jobId: nextJobId || undefined,
    customerId: nextCustomerId || undefined,
  };
}

async function applySmsJobLinks(doc, links) {
  if (!doc || !links) return false;
  let dirty = false;
  if (links.jobId && String(doc.jobId || '') !== String(links.jobId)) {
    doc.jobId = links.jobId;
    dirty = true;
  }
  if (links.customerId && String(doc.customerId || '') !== String(links.customerId)) {
    doc.customerId = links.customerId;
    dirty = true;
  }
  return dirty;
}

function formatJobSmsNote(direction, body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  const preview = text.length > 180 ? `${text.slice(0, 177)}…` : text;
  if (direction === 'inbound') {
    return preview ? `Text received: ${preview}` : 'Text received';
  }
  return preview ? `Text sent: ${preview}` : 'Text sent';
}

async function resolveSmsActivityAuthor(createdBy, jobId) {
  if (optionalObjectId(createdBy)) return createdBy;
  if (jobId) {
    const prior = await SmsMessage.findOne({
      jobId,
      direction: 'outbound',
      createdBy: { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .select('createdBy')
      .lean();
    if (prior?.createdBy) return prior.createdBy;
  }
  const fallback = await User.findOne({ isActive: true }).select('_id').lean();
  return fallback?._id;
}

async function recordJobSmsTimeline({ jobId, customerId, direction, body, createdBy, io }) {
  const id = optionalObjectId(jobId);
  if (!id) return;
  const job = await Job.findById(id);
  if (!job) return;

  const inbound = direction === 'inbound';
  const content = formatJobSmsNote(direction, body);
  const authorId = await resolveSmsActivityAuthor(createdBy, id);

  job.notes.push({
    content,
    createdBy: authorId || undefined,
    createdByName: inbound ? 'Customer' : undefined,
    createdAt: new Date(),
    isSms: true,
    smsDirection: inbound ? 'inbound' : 'outbound',
  });
  if (inbound) {
    job.unreadCustomerSmsCount = (Number(job.unreadCustomerSmsCount) || 0) + 1;
  }
  await job.save();

  if (authorId) {
    try {
      await Activity.create({
        type: 'sms',
        jobId: job._id,
        customerId: customerId || job.customerId,
        note: content,
        createdBy: authorId,
      });
    } catch (error) {
      console.error('Failed to log SMS activity:', error?.message || error);
    }
  }

  try {
    await emitJobUpdated(io, job);
  } catch (error) {
    console.error('Failed to emit job SMS update:', error?.message || error);
  }
}

function skipJobSmsTimeline(source) {
  return source === 'employee' || source === 'rfid-sms-punch' || source === 'payment_notification';
}

/**
 * Inbound webhooks have no JWT, so pick the shop tenant carefully.
 * Prefer explicit env, then customer/outbound match, then the sole real tenant.
 */
async function resolveInboundTenantId({ from, to, preferredTenantId } = {}) {
  if (preferredTenantId) return String(preferredTenantId);

  const slug = String(process.env.TWILIO_INBOUND_TENANT_SLUG || '').trim();
  if (slug) {
    const tenant = await ensureTenantBySlug(slug);
    if (tenant?._id) return String(tenant._id);
  }

  const envId = String(process.env.TWILIO_INBOUND_TENANT_ID || '').trim();
  if (/^[a-fA-F0-9]{24}$/.test(envId)) return envId;

  const fromVariants = phoneMatchVariants(from);
  if (fromVariants.length) {
    const clockPhone = await findActivePhoneByFrom(from);
    if (clockPhone?.tenantId) return String(clockPhone.tenantId);
    const customer = await Customer.findOne({
      $or: [
        { primaryPhone: { $in: fromVariants } },
        { phones: { $in: fromVariants } },
        { 'contactPhones.value': { $in: fromVariants } },
      ],
    })
      .setOptions({ bypassTenant: true })
      .select('tenantId')
      .lean();
    if (customer?.tenantId) return String(customer.tenantId);

    const prior = await SmsMessage.findOne({
      direction: 'outbound',
      to: { $in: fromVariants },
      tenantId: { $exists: true, $ne: null },
    })
      .setOptions({ bypassTenant: true })
      .sort({ createdAt: -1 })
      .select('tenantId')
      .lean();
    if (prior?.tenantId) return String(prior.tenantId);
  }

  // Prefer matching our Twilio "To" against recent outbound from that number's tenant.
  const toVariants = phoneMatchVariants(to);
  if (toVariants.length) {
    const priorFromUs = await SmsMessage.findOne({
      direction: 'outbound',
      from: { $in: toVariants },
      tenantId: { $exists: true, $ne: null },
    })
      .setOptions({ bypassTenant: true })
      .sort({ createdAt: -1 })
      .select('tenantId')
      .lean();
    if (priorFromUs?.tenantId) return String(priorFromUs.tenantId);
  }

  const tenants = await Tenant.find({ slug: { $ne: 'default' } })
    .select('_id slug')
    .limit(5)
    .lean();
  if (tenants.length === 1) return String(tenants[0]._id);

  const defaultTenant = await ensureDefaultTenant();
  return String(defaultTenant._id);
}

function twilioBasicAuth() {
  const { accountSid, authToken } = getTwilioConfig();
  if (!accountSid || !authToken) return '';
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

function mediaFromTwilioForm(body) {
  const count = Math.min(parseInt(body?.NumMedia, 10) || 0, 5);
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const url = String(body?.[`MediaUrl${i}`] || '').trim();
    const contentType = String(body?.[`MediaContentType${i}`] || 'image/jpeg').trim();
    if (url) items.push({ url, contentType });
  }
  return items;
}

async function downloadTwilioPhotos(items) {
  const auth = twilioBasicAuth();
  if (!auth) return [];
  const stored = [];
  for (const item of items) {
    if (!String(item.contentType || '').toLowerCase().startsWith('image/')) continue;
    try {
      const response = await fetch(item.url, { headers: { Authorization: auth } });
      if (!response.ok) continue;
      const contentType = String(response.headers.get('content-type') || item.contentType || 'image/jpeg')
        .split(';')[0]
        .trim();
      if (!contentType.toLowerCase().startsWith('image/')) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > 5 * 1024 * 1024) continue;
      stored.push(await storeSmsMediaBuffer({ buffer, contentType }));
    } catch (error) {
      console.error('Failed to store inbound photo:', error?.message || error);
    }
  }
  return stored;
}

async function listTwilioMessagePhotos(messageSid) {
  const { accountSid } = getTwilioConfig();
  const auth = twilioBasicAuth();
  if (!accountSid || !auth || !messageSid) return [];
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${encodeURIComponent(messageSid)}/Media.json`,
    { headers: { Authorization: auth } },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return [];
  const list = Array.isArray(data.media_list) ? data.media_list : [];
  return list
    .map((row) => {
      const uri = String(row.uri || '').replace(/\.json$/, '');
      if (!uri) return null;
      return {
        url: uri.startsWith('http') ? uri : `https://api.twilio.com${uri}`,
        contentType: row.content_type || 'image/jpeg',
      };
    })
    .filter(Boolean);
}

async function attachInboundPhotos(doc, items) {
  if (!doc || !items?.length) return doc;
  if (Array.isArray(doc.media) && doc.media.length) return doc;
  const stored = await downloadTwilioPhotos(items);
  if (!stored.length) return doc;
  doc.media = stored;
  await doc.save();
  return doc;
}

async function upsertInboundSms({ from, to, body, twilioSid, preferredTenantId, createdAt }) {
  const tenantId = await resolveInboundTenantId({ from, to, preferredTenantId });
  const fromNorm = normalizeToE164(from) || String(from || '').trim();
  const toNorm = normalizeToE164(to) || String(to || '').trim();
  const bodyText = String(body || '').trim();
  const sid = twilioSid ? String(twilioSid).trim() : '';

  return runWithTenantContext({ tenantId, bypassTenant: false }, async () => {
    if (sid) {
      const existing = await SmsMessage.findOne({ twilioSid: sid })
        .setOptions({ bypassTenant: true });
      if (existing) {
        let dirty = false;
        if (String(existing.tenantId || '') !== String(tenantId)) {
          existing.tenantId = tenantId;
          dirty = true;
        }
        if (bodyText && existing.body !== bodyText) {
          existing.body = bodyText;
          dirty = true;
        }
        if (fromNorm && existing.from !== fromNorm) {
          existing.from = fromNorm;
          dirty = true;
        }
        if (toNorm && existing.to !== toNorm) {
          existing.to = toNorm;
          dirty = true;
        }
        if (!existing.jobId || !existing.customerId) {
          const links = await resolveSmsJobLinks({
            from: fromNorm,
            to: toNorm,
            direction: 'inbound',
          });
          if (await applySmsJobLinks(existing, links)) dirty = true;
        }
        if (dirty) await existing.save();
        return { doc: existing, created: false };
      }
    }

    const links = await resolveSmsJobLinks({
      from: fromNorm,
      to: toNorm,
      direction: 'inbound',
    });
    const payload = {
      direction: 'inbound',
      from: fromNorm,
      to: toNorm,
      body: bodyText,
      twilioSid: sid || undefined,
      source: 'inbound',
      tenantId,
      jobId: links.jobId,
      customerId: links.customerId,
    };
    if (createdAt) payload.createdAt = new Date(createdAt);

    const doc = await SmsMessage.create(payload);
    return { doc, created: true };
  });
}

async function logInboundSms({ from, to, body, twilioSid, io, mediaItems }) {
  const { doc, created } = await upsertInboundSms({ from, to, body, twilioSid });
  if (doc && mediaItems?.length) {
    try {
      await attachInboundPhotos(doc, mediaItems);
    } catch (error) {
      console.error('Failed to attach inbound photos:', error?.message || error);
    }
  }
  if (io && created && doc?.tenantId) {
    publishSmsInboundCreated(io, doc.tenantId, {
      id: String(doc._id),
      from: doc.from || '',
      body: doc.body || '',
      createdAt: doc.createdAt,
    });
  }
  if (created && doc?.jobId) {
    try {
      await recordJobSmsTimeline({
        jobId: doc.jobId,
        customerId: doc.customerId,
        direction: 'inbound',
        body: doc.body || (Array.isArray(doc.media) && doc.media.length ? 'Photo' : ''),
        io,
      });
    } catch (error) {
      console.error('Failed to record inbound SMS on job:', error?.message || error);
    }
  }
  return { doc, created };
}

async function logOutboundSms({
  from,
  to,
  body,
  twilioSid,
  source,
  createdBy,
  tenantId,
  deliveryStatus,
  jobId,
  customerId,
  io,
  media,
}) {
  const toNorm = normalizeToE164(to) || String(to || '').trim();
  const links = await resolveSmsJobLinks({
    to: toNorm,
    direction: 'outbound',
    jobId,
    customerId,
  });
  const payload = {
    direction: 'outbound',
    from: from || undefined,
    to: toNorm,
    body: String(body || '').trim(),
    twilioSid: twilioSid || undefined,
    deliveryStatus: normalizeDeliveryStatus(deliveryStatus) || 'queued',
    statusUpdatedAt: new Date(),
    source: source || 'other',
    createdBy: createdBy || undefined,
    jobId: links.jobId,
    customerId: links.customerId,
  };
  if (Array.isArray(media) && media.length) payload.media = media;
  if (tenantId) {
    payload.tenantId = tenantId;
  }
  await SmsMessage.create(payload);
  if (links.jobId && !skipJobSmsTimeline(source)) {
    try {
      await recordJobSmsTimeline({
        jobId: links.jobId,
        customerId: links.customerId,
        direction: 'outbound',
        body: payload.body || (Array.isArray(media) && media.length ? 'Photo' : ''),
        createdBy,
        io,
      });
    } catch (error) {
      console.error('Failed to record outbound SMS on job:', error?.message || error);
    }
  }
}

async function inboundSms(req, res) {
  try {
    const from = req.body?.From || 'unknown';
    const to = req.body?.To || 'unknown';
    const body = req.body?.Body || '';
    const messageSid = req.body?.MessageSid || undefined;
    console.log('[Twilio SMS] from=%s to=%s body=%s', from, to, body);

    try {
      await logInboundSms({
        from,
        to,
        body,
        twilioSid: messageSid,
        io: req.app.get('io'),
        mediaItems: mediaFromTwilioForm(req.body),
      });
    } catch (logError) {
      console.error('Failed to log inbound SMS:', logError?.message || logError);
    }

    let confirmation = '';
    try {
      const punch = await tryRecordSmsPunch({ from, body, io: req.app.get('io') });
      confirmation = String(punch?.confirmation || '').trim();
    } catch (punchError) {
      console.error('Failed to record SMS punch:', punchError?.message || punchError);
    }

    if (confirmation) {
      const safe = confirmation
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return xmlResponse(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${safe}</Message></Response>`
      );
    }

    // Empty TwiML acknowledges receipt without auto-replying.
    return xmlResponse(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`
    );
  } catch (error) {
    console.error('Twilio inboundSms error:', error);
    return xmlResponse(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`
    );
  }
}

async function inboundVoice(req, res) {
  try {
    const from = req.body?.From || 'unknown';
    const to = req.body?.To || 'unknown';
    console.log('[Twilio Voice] from=%s to=%s', from, to);

    return xmlResponse(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello. You reached L I T. This line is active.</Say>
</Response>`
    );
  } catch (error) {
    console.error('Twilio inboundVoice error:', error);
    return xmlResponse(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`
    );
  }
}

function getTwilioConfig() {
  const strip = (value) => {
    let s = String(value || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    return s;
  };
  return {
    accountSid: strip(process.env.TWILIO_ACCOUNT_SID),
    authToken: strip(process.env.TWILIO_AUTH_TOKEN),
    from: strip(process.env.TWILIO_PHONE_NUMBER),
  };
}

function formatTwilioApiError(data, httpStatus) {
  const message = String(data?.message || '').trim();
  const code = data?.code;

  if (/authenticate/i.test(message) || code === 20003) {
    return {
      message:
        'Twilio rejected the server credentials (invalid Account SID or Auth Token). Update TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Render, then redeploy.',
      status: 502,
    };
  }
  if (code === 21606 || /from.*invalid|not a valid.*from/i.test(message)) {
    return {
      message:
        'TWILIO_PHONE_NUMBER is invalid or not on your Twilio account. Use your Twilio number in E.164 format, e.g. +15551234567.',
      status: 400,
    };
  }
  if (code === 21211 || /invalid.*to/i.test(message)) {
    return { message: 'Recipient phone number is invalid for Twilio.', status: 400 };
  }

  return {
    message: message || `Twilio API error (${httpStatus})`,
    status: httpStatus >= 400 && httpStatus < 500 ? httpStatus : 502,
  };
}

async function getTwilioConfigStatus(req, res) {
  try {
    if (!req.user || !['super_admin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { accountSid, authToken, from } = getTwilioConfig();
    const publicBase = getPublicApiBaseUrl(req);
    return res.json({
      configured: Boolean(accountSid && authToken && from),
      hasAccountSid: Boolean(accountSid),
      hasAuthToken: Boolean(authToken),
      hasFromNumber: Boolean(from),
      accountSidLooksValid: /^AC[a-f0-9]{32}$/i.test(accountSid),
      fromNumberLooksValid: /^\+1\d{10}$/.test(normalizeToE164(from)),
      inboundWebhookUrl: publicBase ? `${publicBase}/twilio/sms` : null,
      statusCallbackUrl: publicBase ? `${publicBase}/twilio/sms-status` : null,
      publicApiBaseUrlConfigured: Boolean(String(process.env.PUBLIC_API_BASE_URL || '').trim()),
    });
  } catch (error) {
    console.error('getTwilioConfigStatus error:', error);
    return res.status(500).json({ error: error.message || 'Failed to read Twilio config' });
  }
}

/**
 * List recent inbound Twilio messages and upsert them. Used by the admin Pull
 * button and the all-day background poll. REST list is not billed as SMS.
 */
async function pullInboundFromTwilio({ preferredTenantId, limit = 100, io } = {}) {
  const { accountSid, authToken, from: ourNumber } = getTwilioConfig();
  if (!accountSid || !authToken) {
    return { scanned: 0, imported: 0, updated: 0, skipped: 0, skippedReason: 'not_configured' };
  }

  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const params = new URLSearchParams({
    PageSize: String(pageSize),
  });
  if (ourNumber) params.set('To', normalizeToE164(ourNumber) || ourNumber);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.message || data?.error || `Twilio list failed (${response.status})`;
    const error = new Error(String(msg));
    error.status = 502;
    throw error;
  }

  let messages = Array.isArray(data?.messages) ? data.messages : [];
  if (messages.length === 0 && ourNumber) {
    const fallbackUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?PageSize=${pageSize}`;
    const fallbackRes = await fetch(fallbackUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
    });
    const fallbackData = await fallbackRes.json().catch(() => ({}));
    if (fallbackRes.ok && Array.isArray(fallbackData?.messages)) {
      messages = fallbackData.messages;
    }
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of messages) {
    const direction = String(row?.direction || '').toLowerCase();
    if (!direction.includes('inbound')) {
      skipped += 1;
      continue;
    }
    const result = await upsertInboundSms({
      from: row.from,
      to: row.to,
      body: row.body,
      twilioSid: row.sid,
      preferredTenantId,
      createdAt: row.date_created || row.date_sent,
    });
    if (Number(row.num_media) > 0 && result.doc && !(result.doc.media || []).length) {
      try {
        const photos = await listTwilioMessagePhotos(row.sid);
        await attachInboundPhotos(result.doc, photos);
      } catch (mediaError) {
        console.error('Failed to pull inbound photos:', mediaError?.message || mediaError);
      }
    }
    if (result.created) {
      imported += 1;
      if (io && result.doc?.tenantId) {
        publishSmsInboundCreated(io, result.doc.tenantId, {
          id: String(result.doc._id),
          from: result.doc.from || '',
          body: result.doc.body || '',
          createdAt: result.doc.createdAt,
        });
      }
    } else {
      updated += 1;
    }
    const scannedAt = result.doc?.createdAt || row.date_created || row.date_sent;
    const ageMs = Date.now() - new Date(scannedAt || Date.now()).getTime();
    const recentEnough = result.created || (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 2 * 60 * 60 * 1000);
    if (!recentEnough) continue;
    try {
      const punch = await tryRecordSmsPunch({
        from: row.from,
        body: row.body,
        io,
        tenantId: result.doc?.tenantId,
        scannedAt,
      });
      if (!punch?.scan || !punch?.confirmation) continue;
      console.log('[SMS punch] recorded', punch.scan.displayName, row.body || '(blank)');
      try {
        const sent = await sendSmsViaTwilio({ to: row.from, message: punch.confirmation });
        await logOutboundSms({
          from: sent.from,
          to: sent.to,
          body: punch.confirmation,
          twilioSid: sent.sid,
          source: 'rfid-sms-punch',
          tenantId: result.doc?.tenantId || punch.scan.tenantId,
          deliveryStatus: sent.status,
        });
      } catch (sendError) {
        console.error('[SMS punch] confirmation send failed:', sendError?.message || sendError);
      }
    } catch (punchError) {
      console.error('Failed to record polled SMS punch:', punchError?.message || punchError);
    }
  }

  return {
    scanned: messages.length,
    imported,
    updated,
    skipped,
  };
}

async function syncInboundFromTwilio(req, res) {
  try {
    if (!req.user || !['super_admin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { accountSid, authToken } = getTwilioConfig();
    if (!accountSid || !authToken) {
      return res.status(400).json({ error: 'Twilio credentials are not configured' });
    }

    const preferredTenantId =
      req.user?.tenantId && typeof req.user.tenantId === 'object'
        ? req.user.tenantId._id || req.user.tenantId.id
        : req.user?.tenantId;

    const result = await pullInboundFromTwilio({
      preferredTenantId,
      limit: req.body?.limit,
      io: req.app?.get?.('io'),
    });
    return res.json(result);
  } catch (error) {
    console.error('syncInboundFromTwilio error:', error?.message || error);
    const status = error?.status || 500;
    return res.status(status).json({ error: error?.message || 'Failed to sync inbound messages' });
  }
}

function getPublicApiBaseUrl(req) {
  const envBase = String(process.env.PUBLIC_API_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/$/, '');
  if (req) return getApiBaseUrl(req);
  return '';
}

function buildSmsStatusCallbackUrl(req) {
  const base = getPublicApiBaseUrl(req);
  if (!base) return undefined;
  return `${base}/twilio/sms-status`;
}

function normalizeDeliveryStatus(status) {
  return String(status || '').trim().toLowerCase() || undefined;
}

function deliveryPatchFromTwilioStatus(status, errorCode, errorMessage) {
  const normalized = normalizeDeliveryStatus(status);
  const patch = {
    deliveryStatus: normalized || undefined,
    statusUpdatedAt: new Date(),
  };
  if (normalized === 'delivered') {
    patch.deliveredAt = new Date();
  }
  if (errorCode != null && String(errorCode).trim() !== '') {
    patch.errorCode = String(errorCode);
  }
  if (errorMessage != null && String(errorMessage).trim() !== '') {
    patch.errorMessage = String(errorMessage);
  }
  return patch;
}

async function applyDeliveryUpdateBySid(twilioSid, status, errorCode, errorMessage) {
  if (!twilioSid) return;
  const patch = deliveryPatchFromTwilioStatus(status, errorCode, errorMessage);
  await SmsMessage.updateMany({ twilioSid }, { $set: patch }).setOptions({ bypassTenant: true });
  await ScheduledSms.updateMany({ twilioSid }, { $set: patch }).setOptions({ bypassTenant: true });
}

async function fetchTwilioMessageBySid(sid) {
  const { accountSid, authToken } = getTwilioConfig();
  if (!accountSid || !authToken || !sid) return null;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${encodeURIComponent(sid)}.json`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
    }
  );
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function syncDocDeliveryFromTwilio(doc, Model) {
  if (!doc?.twilioSid) return doc;
  const remote = await fetchTwilioMessageBySid(doc.twilioSid);
  if (!remote?.status) return doc;
  const patch = deliveryPatchFromTwilioStatus(remote.status, remote.error_code, remote.error_message);
  await Model.findByIdAndUpdate(doc._id, { $set: patch });
  return { ...doc, ...patch };
}

const PENDING_DELIVERY_STATUSES = new Set(['queued', 'sending', 'accepted']);
const STALE_PENDING_MS = 20 * 1000;
const ABANDONED_PENDING_MS = 10 * 60 * 1000;
const PENDING_DISPLAY_MS = 2 * 60 * 1000;
const MAX_STATUS_SYNC_PER_REQUEST = 40;

function isPendingDeliveryStatus(status) {
  const normalized = normalizeDeliveryStatus(status);
  return !normalized || PENDING_DELIVERY_STATUSES.has(normalized);
}

function outboundListStatus(doc) {
  const delivery = normalizeDeliveryStatus(doc.deliveryStatus);
  if (delivery === 'delivered' || delivery === 'read') return 'delivered';
  if (delivery === 'failed' || delivery === 'undelivered') return 'failed';
  if (delivery === 'sent') return 'sent';
  if (isPendingDeliveryStatus(delivery)) {
    const age = Date.now() - new Date(doc.createdAt || doc.sentAt || 0).getTime();
    if (Number.isFinite(age) && age < PENDING_DISPLAY_MS) return delivery || 'queued';
    return 'sent';
  }
  return delivery || 'sent';
}

function isStalePendingDelivery(doc, now = Date.now()) {
  if (!doc?.twilioSid) return false;
  if (!isPendingDeliveryStatus(doc.deliveryStatus)) return false;
  const t = new Date(doc.statusUpdatedAt || doc.createdAt || 0).getTime();
  return Number.isFinite(t) && now - t >= STALE_PENDING_MS;
}

async function runWithConcurrency(items, concurrency, fn) {
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve()
      .then(() => fn(item))
      .finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

/**
 * Twilio starts messages as "queued". If status callbacks never arrived, the Messages
 * page stays stuck on Queued. Pull live status (or clear abandoned queued rows to sent).
 */
async function refreshStaleDeliveryStatuses(docs, Model, { limit = MAX_STATUS_SYNC_PER_REQUEST } = {}) {
  if (!Array.isArray(docs) || docs.length === 0) return docs;
  const stale = docs.filter((doc) => isStalePendingDelivery(doc)).slice(0, limit);
  if (stale.length === 0) return docs;

  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  await runWithConcurrency(stale, 6, async (doc) => {
    try {
      const remote = await fetchTwilioMessageBySid(doc.twilioSid);
      let patch = null;
      if (remote?.status) {
        patch = deliveryPatchFromTwilioStatus(remote.status, remote.error_code, remote.error_message);
      } else {
        const age = Date.now() - new Date(doc.createdAt || 0).getTime();
        if (age >= ABANDONED_PENDING_MS) {
          patch = { deliveryStatus: 'sent', statusUpdatedAt: new Date() };
        }
      }
      if (!patch) return;
      await Model.findByIdAndUpdate(doc._id, { $set: patch });
      byId.set(String(doc._id), { ...doc, ...patch });
    } catch (error) {
      console.warn(
        '[SMS status refresh] failed',
        String(doc._id),
        error?.message || error,
      );
    }
  });

  return docs.map((doc) => byId.get(String(doc._id)) || doc);
}

function normalizeMediaUrls(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => /^https?:\/\//i.test(value));
}

function getApiBaseUrl(req) {
  const envBase = String(process.env.PUBLIC_API_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = req.get('host');
  return `${proto}://${host}`;
}

function getMediaSigningSecret() {
  return (
    String(process.env.TWILIO_MEDIA_SECRET || '').trim() ||
    String(process.env.JWT_SECRET || '').trim() ||
    'fallback-media-secret'
  );
}

function signMediaToken({ fileId, expiresAt }) {
  const payload = `${String(fileId)}:${String(expiresAt)}`;
  return crypto.createHmac('sha256', getMediaSigningSecret()).update(payload).digest('hex');
}

function buildSignedMediaUrl(req, fileId, ttlMs = 10 * 60 * 1000) {
  const expiresAt = Date.now() + ttlMs;
  const sig = signMediaToken({ fileId, expiresAt });
  const base = getApiBaseUrl(req);
  return `${base}/twilio/media/${fileId}?exp=${expiresAt}&sig=${sig}`;
}

async function resolveMediaUrls(req) {
  const directUrls = normalizeMediaUrls(req.body?.mediaUrl);
  const mediaFileId = String(req.body?.mediaFileId || '').trim();
  if (!mediaFileId) return directUrls;

  const file = await File.findById(mediaFileId).select('_id');
  if (!file) {
    throw new Error('Media file not found');
  }

  const downloadUrl = buildSignedMediaUrl(req, file._id);
  return [...directUrls, downloadUrl];
}

async function twilioMediaDownload(req, res) {
  try {
    const fileId = String(req.params?.id || '').trim();
    const exp = Number(req.query?.exp);
    const sig = String(req.query?.sig || '').trim();
    if (!fileId || !Number.isFinite(exp) || !sig) {
      return res.status(400).json({ error: 'Missing media access parameters' });
    }
    if (Date.now() > exp) {
      return res.status(403).json({ error: 'Media link expired' });
    }
    const expected = signMediaToken({ fileId, expiresAt: exp });
    if (sig !== expected) {
      return res.status(403).json({ error: 'Invalid media signature' });
    }

    const file = await File.findById(fileId).setOptions({ bypassTenant: true });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName || 'file'}"`);
    const fileStream = await getFileStream(file);
    return fileStream.pipe(res);
  } catch (error) {
    console.error('Twilio media download error:', error?.message || error);
    return res.status(500).json({ error: 'Failed to serve media file' });
  }
}

/**
 * Resolves destination E.164 from employeeUserId, employeeContactId, or `to`.
 */
async function resolveSmsDestination(body = {}) {
  const User = require('../models/User');
  const EmployeeContact = require('../models/EmployeeContact');
  const employeeUserId = String(body.employeeUserId || '').trim();
  const employeeContactId = String(body.employeeContactId || '').trim();
  const rawTo = body.to;

  if (employeeContactId) {
    if (!/^[a-fA-F0-9]{24}$/.test(employeeContactId)) {
      throw new Error('Invalid recipient selection');
    }
    const c = await EmployeeContact.findById(employeeContactId).select('mobile');
    if (!c) throw new Error('Employee contact not found');
    const normalized = normalizeToE164(c.mobile);
    if (!normalized) {
      throw new Error('That employee has no mobile number on file. Add it under Employees without a login.');
    }
    return normalized;
  }

  if (employeeUserId) {
    if (!/^[a-fA-F0-9]{24}$/.test(employeeUserId)) {
      throw new Error('Invalid employee selection');
    }
    const u = await User.findById(employeeUserId).select('mobile isPending isActive');
    if (!u) throw new Error('User not found');
    if (u.isPending) {
      throw new Error('That account is not active yet');
    }
    if (u.isActive === false) {
      throw new Error('That account is inactive');
    }
    const normalized = normalizeToE164(u.mobile);
    if (!normalized) {
      throw new Error('That team member has no mobile number on file. Add it in User Management.');
    }
    return normalized;
  }

  if (rawTo != null && String(rawTo).trim() !== '') {
    const normalized = normalizeToE164(rawTo);
    if (!normalized) {
      throw new Error('Recipient phone number is invalid');
    }
    return normalized;
  }

  throw new Error('Select an employee to send the message to');
}

async function resolveOutgoingSmsTo(req) {
  return resolveSmsDestination(req.body || {});
}

async function sendResolvedEmployeeSms({
  employeeUserId,
  employeeContactId,
  message,
  createdBy,
  tenantId,
}) {
  const to = await resolveSmsDestination({ employeeUserId, employeeContactId });
  const data = await sendSmsViaTwilio({ to, message });
  try {
    await logOutboundSms({
      from: data.from,
      to: data.to,
      body: message,
      twilioSid: data.sid,
      deliveryStatus: data.status,
      source: 'employee',
      createdBy,
      tenantId,
    });
  } catch (logError) {
    console.error('Failed to log outbound SMS:', logError?.message || logError);
  }
  return data;
}

async function sendSmsViaTwilio({ to, message, mediaUrl, statusCallbackUrl }) {
  const { accountSid, authToken, from } = getTwilioConfig();
  const normalizedTo = normalizeToE164(to);
  const body = String(message || '').trim();
  const mediaUrls = normalizeMediaUrls(mediaUrl);

  if (!accountSid || !authToken) {
    throw new Error('Twilio account is not configured');
  }
  if (!normalizedTo) {
    throw new Error('Recipient phone number is required');
  }
  if (!body && mediaUrls.length === 0) {
    throw new Error('Message or media URL is required');
  }
  if (!from) {
    throw new Error('TWILIO_PHONE_NUMBER is not configured');
  }

  const form = new URLSearchParams();
  form.set('To', normalizedTo);
  form.set('From', from);
  if (body) {
    form.set('Body', body);
  }
  mediaUrls.forEach((url) => form.append('MediaUrl', url));
  if (statusCallbackUrl) {
    form.set('StatusCallback', statusCallbackUrl);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const formatted = formatTwilioApiError(data, response.status);
    const err = new Error(formatted.message);
    err.status = formatted.status;
    throw err;
  }

  return {
    sid: data.sid,
    status: data.status,
    to: data.to || normalizedTo,
    from: data.from || from,
  };
}

/**
 * Messages page: send to any number the user types (still requires login).
 * `/send-sms` remains restricted to employees on file + allowlisted `to`.
 */
async function sendSmsAdhoc(req, res) {
  try {
    const rawTo = String(req.body?.to ?? '').trim();
    const normalized = normalizeToE164(rawTo);
    if (!normalized) {
      return res.status(400).json({ error: 'Enter a valid phone number' });
    }
    const mediaUrls = await resolveMediaUrls(req);
    const mediaFileId = String(req.body?.mediaFileId || '').trim();
    let outboundMedia = [];
    if (mediaFileId) {
      const staged = await File.findById(mediaFileId).select('mimetype');
      if (staged) {
        outboundMedia = [{ fileId: staged._id, contentType: staged.mimetype || 'image/jpeg' }];
      }
    }
    const statusCallbackUrl = buildSmsStatusCallbackUrl(req);
    const data = await sendSmsViaTwilio({
      to: normalized,
      message: req.body?.message,
      mediaUrl: mediaUrls,
      statusCallbackUrl,
    });
    try {
      await logOutboundSms({
        from: data.from,
        to: data.to,
        body: req.body?.message,
        twilioSid: data.sid,
        deliveryStatus: data.status,
        source: 'adhoc',
        createdBy: req.user?._id,
        tenantId: req.user?.tenantId,
        jobId: req.body?.jobId,
        customerId: req.body?.customerId,
        io: req.app.get('io'),
        media: outboundMedia,
      });
    } catch (logError) {
      console.error('Failed to log outbound SMS:', logError?.message || logError);
    }
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    console.error('Twilio sendSmsAdhoc error:', error?.message || error);
    const status =
      error?.status ||
      (/invalid|required|not configured/i.test(String(error?.message)) ? 400 : 500);
    return res.status(status).json({ error: error?.message || 'Failed to send SMS' });
  }
}

async function sendSms(req, res) {
  try {
    const to = await resolveOutgoingSmsTo(req);
    const mediaUrls = await resolveMediaUrls(req);
    const statusCallbackUrl = buildSmsStatusCallbackUrl(req);
    const data = await sendSmsViaTwilio({
      to,
      message: req.body?.message,
      mediaUrl: mediaUrls,
      statusCallbackUrl,
    });
    try {
      await logOutboundSms({
        from: data.from,
        to: data.to,
        body: req.body?.message,
        twilioSid: data.sid,
        deliveryStatus: data.status,
        source: 'employee',
        createdBy: req.user?._id,
        tenantId: req.user?.tenantId,
      });
    } catch (logError) {
      console.error('Failed to log outbound SMS:', logError?.message || logError);
    }
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    console.error('Twilio sendSms error:', error?.message || error);
    const status = /select an employee|invalid|not found|inactive|no mobile|team member|roster|contact/i.test(
      String(error?.message)
    )
      ? 400
      : 500;
    return res.status(status).json({ error: error?.message || 'Failed to send SMS' });
  }
}

async function scheduleSmsToNumber(res, { to, message, sendAtInput, createdBy, customerId, appointmentId }) {
  const body = String(message || '').trim();

  if (!to) {
    return res.status(400).json({ error: 'Recipient phone number is required' });
  }
  if (!body) {
    return res.status(400).json({ error: 'Message is required' });
  }
  if (!sendAtInput) {
    return res.status(400).json({ error: 'Send date and time are required' });
  }

  const sendAt = new Date(sendAtInput);
  if (Number.isNaN(sendAt.getTime())) {
    return res.status(400).json({ error: 'Invalid send date/time' });
  }
  if (sendAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Send time must be in the future' });
  }

  const sms = await ScheduledSms.create({
    to,
    message: body,
    sendAt,
    createdBy: createdBy || undefined,
    customerId: customerId || undefined,
    appointmentId: appointmentId || undefined,
    status: 'scheduled',
  });

  return res.status(201).json({
    success: true,
    mode: 'scheduled',
    id: sms._id,
    sendAt: sms.sendAt,
    to: sms.to,
  });
}

async function scheduleSms(req, res) {
  try {
    let to;
    try {
      to = await resolveOutgoingSmsTo(req);
    } catch (e) {
      return res.status(400).json({ error: e?.message || 'Invalid recipient' });
    }

    const sendAtInput = req.body?.sendAt;
    if (!sendAtInput) {
      const message = String(req.body?.message || '').trim();
      const sendAt = new Date();
      if (!to) {
        return res.status(400).json({ error: 'Recipient phone number is required' });
      }
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }
      const statusCallbackUrl = buildSmsStatusCallbackUrl(req);
      const data = await sendSmsViaTwilio({ to, message, statusCallbackUrl });
      try {
        await logOutboundSms({
          from: data.from,
          to: data.to,
          body: message,
          twilioSid: data.sid,
          deliveryStatus: data.status,
          source: 'other',
          createdBy: req.user?._id,
          tenantId: req.user?.tenantId,
          jobId: req.body?.jobId,
          customerId: req.body?.customerId,
          io: req.app.get('io'),
        });
      } catch (logError) {
        console.error('Failed to log outbound SMS:', logError?.message || logError);
      }
      return res.status(200).json({ success: true, mode: 'sent', ...data });
    }

    return scheduleSmsToNumber(res, {
      to,
      message: req.body?.message,
      sendAtInput,
      createdBy: req.user?._id,
      customerId: req.body?.customerId,
      appointmentId: req.body?.appointmentId,
    });
  } catch (error) {
    console.error('Twilio scheduleSms error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to schedule SMS' });
  }
}

/** Messages page: schedule to any number the user types (same as send-sms-adhoc). */
async function scheduleSmsAdhoc(req, res) {
  try {
    const rawTo = String(req.body?.to ?? '').trim();
    const normalized = normalizeToE164(rawTo);
    if (!normalized) {
      return res.status(400).json({ error: 'Enter a valid phone number' });
    }

    return scheduleSmsToNumber(res, {
      to: normalized,
      message: req.body?.message,
      sendAtInput: req.body?.sendAt,
      createdBy: req.user?._id,
    });
  } catch (error) {
    console.error('Twilio scheduleSmsAdhoc error:', error?.message || error);
    const status = /invalid|required|future|phone/i.test(String(error?.message)) ? 400 : 500;
    return res.status(status).json({ error: error?.message || 'Failed to schedule SMS' });
  }
}

function mapMedia(doc) {
  const items = Array.isArray(doc?.media) ? doc.media : [];
  return items.map((item, index) => ({
    index,
    contentType: item.contentType || 'image/jpeg',
  }));
}

function mapDeliveryFields(doc) {
  return {
    deliveryStatus: doc.deliveryStatus || null,
    deliveredAt: doc.deliveredAt || null,
    readAt: doc.readAt || null,
    statusUpdatedAt: doc.statusUpdatedAt || null,
    errorCode: doc.errorCode || null,
    errorMessage: doc.errorMessage || doc.lastError || null,
  };
}

function mapScheduledRow(doc) {
  const sentAt = doc.sentAt || doc.updatedAt || doc.sendAt || doc.createdAt || null;
  const listStatus =
    doc.status === 'scheduled'
      ? 'scheduled'
      : doc.status === 'failed'
        ? 'failed'
        : outboundListStatus({ ...doc, createdAt: doc.sentAt || doc.createdAt });
  return {
    id: String(doc._id),
    recordType: 'scheduled',
    kind: doc.status === 'scheduled' ? 'scheduled' : 'sent',
    to: doc.to,
    from: null,
    body: doc.message,
    status: listStatus,
    sendAt: doc.sendAt,
    sentAt,
    createdAt: doc.createdAt,
    lastError: doc.lastError || null,
    twilioSid: doc.twilioSid || null,
    ...mapDeliveryFields(doc),
  };
}

function mapOutboundRow(doc) {
  const listStatus = outboundListStatus(doc);
  return {
    id: String(doc._id),
    recordType: 'message',
    kind: 'sent',
    to: doc.to,
    from: doc.from || null,
    body: doc.body,
    status: listStatus,
    sendAt: null,
    sentAt: doc.createdAt,
    createdAt: doc.createdAt,
    lastError: doc.errorMessage || null,
    twilioSid: doc.twilioSid || null,
    media: mapMedia(doc),
    ...mapDeliveryFields(doc),
  };
}

function sentRowSortTime(row) {
  return new Date(row.sentAt || row.createdAt).getTime();
}

function sentRowDedupeKey(row) {
  if (row.twilioSid) return `sid:${row.twilioSid}`;
  const bucket = Math.floor(sentRowSortTime(row) / 120000);
  const bodyKey = String(row.body || '').slice(0, 120);
  return `${row.to || ''}|${bodyKey}|${bucket}`;
}

/** Merge adhoc + scheduled sent rows without dropping the newest from either source. */
function mergeSentRows(outboundDocs, scheduledSentDocs, limit) {
  const byKey = new Map();

  const add = (row) => {
    const key = sentRowDedupeKey(row);
    const existing = byKey.get(key);
    if (!existing || sentRowSortTime(row) >= sentRowSortTime(existing)) {
      byKey.set(key, row);
    }
  };

  outboundDocs.map(mapOutboundRow).forEach(add);
  scheduledSentDocs.map(mapScheduledRow).forEach(add);

  return Array.from(byKey.values())
    .sort((a, b) => sentRowSortTime(b) - sentRowSortTime(a))
    .slice(0, limit);
}

function mapInboundRow(doc) {
  const listStatus = doc.readAt ? 'read' : 'unread';
  return {
    id: String(doc._id),
    recordType: 'message',
    kind: 'received',
    to: doc.to,
    from: doc.from || null,
    body: doc.body,
    status: listStatus,
    sendAt: null,
    sentAt: doc.createdAt,
    createdAt: doc.createdAt,
    lastError: null,
    twilioSid: doc.twilioSid || null,
    media: mapMedia(doc),
    ...mapDeliveryFields(doc),
  };
}

function buildMessageDetailPayload(doc, recordType) {
  const row =
    recordType === 'scheduled'
      ? mapScheduledRow(doc)
      : doc.direction === 'inbound'
        ? mapInboundRow(doc)
        : mapOutboundRow(doc);

  const isInbound = doc.direction === 'inbound' || row.kind === 'received';
  const isOutbound = !isInbound && row.kind !== 'scheduled';

  return {
    ...row,
    direction: isInbound ? 'inbound' : 'outbound',
    fullBody: row.body,
    receiptsNote: isOutbound
      ? 'Standard SMS does not support read receipts from the recipient’s phone. Delivery status comes from your carrier via Twilio.'
      : 'Read status is tracked when you open a received message in this app.',
    canMarkRead: isInbound && !row.readAt,
  };
}

async function streamSmsMessageMedia(req, res) {
  try {
    const index = Number(req.params.index);
    const doc = await SmsMessage.findById(req.params.id);
    const item = Number.isInteger(index) ? doc?.media?.[index] : null;
    if (!doc || !item) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    let stream;
    let contentType = item.contentType || 'image/jpeg';
    if (item.fileId) {
      const file = await File.findById(item.fileId).setOptions({ bypassTenant: true });
      if (!file) return res.status(404).json({ error: 'Photo not found' });
      contentType = file.mimetype || contentType;
      stream = await getFileStream(file);
    } else {
      const opened = await openStoredSmsMedia(item);
      stream = opened.stream;
      contentType = opened.contentType || contentType;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return stream.pipe(res);
  } catch (error) {
    console.error('streamSmsMessageMedia error:', error?.message || error);
    return res.status(500).json({ error: 'Failed to load photo' });
  }
}

async function smsStatusCallback(req, res) {
  try {
    const sid = req.body?.MessageSid || req.body?.SmsSid;
    const status = req.body?.MessageStatus || req.body?.SmsStatus;
    const errorCode = req.body?.ErrorCode;
    const errorMessage = req.body?.ErrorMessage;
    if (sid && status) {
      await applyDeliveryUpdateBySid(sid, status, errorCode, errorMessage);
      console.log('[Twilio SMS status] sid=%s status=%s', sid, status);
    }
    return res.status(200).end();
  } catch (error) {
    console.error('smsStatusCallback error:', error?.message || error);
    return res.status(200).end();
  }
}

async function getSmsDetail(req, res) {
  try {
    const { recordType, id } = req.params;
    if (!id || !['message', 'scheduled'].includes(recordType)) {
      return res.status(400).json({ error: 'Invalid message reference' });
    }

    let doc;
    if (recordType === 'scheduled') {
      doc = await ScheduledSms.findById(id).lean();
    } else {
      doc = await SmsMessage.findById(id).lean();
    }

    if (!doc) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (doc.twilioSid) {
      if (recordType === 'scheduled') {
        await syncDocDeliveryFromTwilio(doc, ScheduledSms);
      } else {
        await syncDocDeliveryFromTwilio(doc, SmsMessage);
      }
      doc =
        recordType === 'scheduled'
          ? await ScheduledSms.findById(id).lean()
          : await SmsMessage.findById(id).lean();
    }

    return res.status(200).json(buildMessageDetailPayload(doc, recordType));
  } catch (error) {
    console.error('getSmsDetail error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to load message' });
  }
}

async function markSmsRead(req, res) {
  try {
    const { id } = req.params;
    const doc = await SmsMessage.findOne({ _id: id, direction: 'inbound' });
    if (!doc) {
      return res.status(404).json({ error: 'Received message not found' });
    }
    if (!doc.readAt) {
      doc.readAt = new Date();
      await doc.save();
      if (doc.jobId) {
        await Job.updateOne(
          { _id: doc.jobId, unreadCustomerSmsCount: { $gt: 0 } },
          { $inc: { unreadCustomerSmsCount: -1 } },
        );
        const job = await Job.findById(doc.jobId);
        if (job) await emitJobUpdated(req, job);
      }
    }
    return res.status(200).json(buildMessageDetailPayload(doc.toObject(), 'message'));
  } catch (error) {
    console.error('markSmsRead error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to mark message read' });
  }
}

async function markJobSmsRead(req, res) {
  try {
    const jobId = optionalObjectId(req.params?.jobId);
    if (!jobId) return res.status(400).json({ error: 'Job is required' });
    const job = await Job.findById(jobId).populate(
      'customerId',
      'name primaryPhone phones contactPhones',
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const variants = collectJobPhoneVariants(job);
    const customerId = job.customerId?._id || job.customerId;
    const or = [{ jobId: job._id }];
    if (customerId) or.push({ customerId });
    if (variants.length) {
      or.push({ from: { $in: variants } });
      or.push({ to: { $in: variants } });
    }

    await SmsMessage.updateMany(
      {
        direction: 'inbound',
        $and: [
          { $or: or },
          { $or: [{ readAt: null }, { readAt: { $exists: false } }] },
        ],
      },
      { $set: { readAt: new Date() } },
    );

    job.unreadCustomerSmsCount = 0;
    await job.save();
    await emitJobUpdated(req, job);
    return res.status(200).json({ ok: true, unreadCustomerSmsCount: 0 });
  } catch (error) {
    console.error('markJobSmsRead error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to mark job messages read' });
  }
}

function partyPhoneVariants(value) {
  const variants = new Set(phoneMatchVariants(value));
  const digits = phoneDigits(normalizeToE164(value) || value);
  const last10 =
    digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits.length >= 10
        ? digits.slice(-10)
        : '';
  if (last10.length === 10) {
    const a = last10.slice(0, 3);
    const b = last10.slice(3, 6);
    const c = last10.slice(6);
    variants.add(`(${a}) ${b}-${c}`);
    variants.add(`(${a})${b}-${c}`);
    variants.add(`${a}-${b}-${c}`);
    variants.add(`${a}.${b}.${c}`);
    variants.add(`${a}${b}${c}`);
  }
  return [...variants].filter(Boolean);
}

async function deleteSms(req, res) {
  try {
    const { recordType, id } = req.params;
    if (!id || !['message', 'scheduled'].includes(recordType)) {
      return res.status(400).json({ error: 'Invalid message reference' });
    }
    const Model = recordType === 'scheduled' ? ScheduledSms : SmsMessage;
    const doc = await Model.findByIdAndDelete(id);
    if (!doc) {
      return res.status(404).json({ error: 'Message not found' });
    }
    return res.status(200).json({ ok: true, id: String(id), recordType });
  } catch (error) {
    console.error('deleteSms error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to delete message' });
  }
}

async function deleteSmsConversation(req, res) {
  try {
    const phone = String(req.query?.phone || req.body?.phone || '').trim();
    const variants = partyPhoneVariants(phone);
    if (!phone || variants.length === 0) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const party = { $in: variants };
    const [messages, scheduled] = await Promise.all([
      SmsMessage.deleteMany({ $or: [{ from: party }, { to: party }] }),
      ScheduledSms.deleteMany({ to: party }),
    ]);
    const deleted = (messages.deletedCount || 0) + (scheduled.deletedCount || 0);
    return res.status(200).json({ ok: true, deleted });
  } catch (error) {
    console.error('deleteSmsConversation error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to delete conversation' });
  }
}

async function getUnreadSmsCount(req, res) {
  try {
    const unread = await SmsMessage.countDocuments({
      direction: 'inbound',
      $or: [{ readAt: null }, { readAt: { $exists: false } }],
    });
    return res.status(200).json({ unread: Number(unread) || 0 });
  } catch (error) {
    console.error('getUnreadSmsCount error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to load unread count' });
  }
}

async function listJobSms(jobId, limit) {
  const job = await Job.findById(jobId).populate(
    'customerId',
    'name primaryPhone phones contactPhones',
  );
  if (!job) return null;

  const variants = collectJobPhoneVariants(job);
  const customerId = job.customerId?._id || job.customerId;
  const or = [{ jobId: job._id }];
  if (customerId) or.push({ customerId });
  if (variants.length) {
    or.push({ from: { $in: variants } });
    or.push({ to: { $in: variants } });
  }

  const [rows, scheduledRows] = await Promise.all([
    SmsMessage.find({ $or: or }).sort({ createdAt: -1 }).limit(limit).lean(),
    variants.length
      ? ScheduledSms.find({ status: 'scheduled', to: { $in: variants } })
          .sort({ sendAt: 1 })
          .limit(limit)
          .lean()
      : Promise.resolve([]),
  ]);

  return {
    scheduled: scheduledRows.map(mapScheduledRow),
    sent: rows.filter((doc) => doc.direction === 'outbound').map(mapOutboundRow),
    received: rows.filter((doc) => doc.direction === 'inbound').map(mapInboundRow),
  };
}

async function listSms(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 500, 1), 2000);
    const jobId = optionalObjectId(req.query?.jobId);
    if (jobId) {
      const data = await listJobSms(jobId, limit);
      if (!data) return res.status(404).json({ error: 'Job not found' });
      return res.status(200).json(data);
    }

    const fetchCap = Math.min(Math.max(limit * 2, limit), 4000);
    const userId = req.user?._id;
    const tenantId = req.user?.tenantId;

    const orphanOutboundQuery =
      userId && tenantId
        ? SmsMessage.find({
            direction: 'outbound',
            createdBy: userId,
            $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
          })
            .setOptions({ bypassTenant: true })
            .sort({ createdAt: -1 })
            .limit(fetchCap)
            .lean()
        : Promise.resolve([]);

    const [scheduledRows, sentScheduledRows, outboundRows, outboundOrphans, inboundRows] =
      await Promise.all([
        ScheduledSms.find({ status: 'scheduled' }).sort({ sendAt: 1 }).limit(limit).lean(),
        ScheduledSms.find({ status: { $in: ['sent', 'failed'] } })
          .sort({ sentAt: -1, updatedAt: -1 })
          .limit(fetchCap)
          .lean(),
        SmsMessage.find({ direction: 'outbound' }).sort({ createdAt: -1 }).limit(fetchCap).lean(),
        orphanOutboundQuery,
        SmsMessage.find({ direction: 'inbound' }).sort({ createdAt: -1 }).limit(limit).lean(),
      ]);

    const outboundCombined = [...outboundRows];
    const seenOutboundIds = new Set(outboundRows.map((d) => String(d._id)));
    for (const doc of outboundOrphans) {
      const id = String(doc._id);
      if (!seenOutboundIds.has(id)) {
        seenOutboundIds.add(id);
        outboundCombined.push(doc);
      }
    }

    const [refreshedOutbound, refreshedScheduledSent] = await Promise.all([
      refreshStaleDeliveryStatuses(outboundCombined, SmsMessage),
      refreshStaleDeliveryStatuses(sentScheduledRows, ScheduledSms),
    ]);

    const sent = mergeSentRows(refreshedOutbound, refreshedScheduledSent, limit);

    return res.status(200).json({
      scheduled: scheduledRows.map(mapScheduledRow),
      sent,
      received: inboundRows.map(mapInboundRow),
    });
  } catch (error) {
    console.error('listSms error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to load messages' });
  }
}

const INBOUND_POLL_MS = 10 * 1000;
let smsSchedulerStarted = false;
function startSmsScheduler(options = {}) {
  if (smsSchedulerStarted) return;
  smsSchedulerStarted = true;
  const io = options.io || null;
  let inboundPollBusy = false;

  const tick = async () => {
    try {
      const due = await ScheduledSms.find({
        status: 'scheduled',
        sendAt: { $lte: new Date() },
      })
        .sort({ sendAt: 1 })
        .limit(25);

      for (const sms of due) {
        try {
          const statusCallbackUrl = buildSmsStatusCallbackUrl();
          const result = await sendSmsViaTwilio({
            to: sms.to,
            message: sms.message,
            statusCallbackUrl,
          });
          sms.status = 'sent';
          sms.sentAt = new Date();
          sms.twilioSid = result.sid;
          sms.deliveryStatus = normalizeDeliveryStatus(result.status) || 'queued';
          sms.statusUpdatedAt = new Date();
          sms.lastError = undefined;
          sms.attempts = (sms.attempts || 0) + 1;
          await sms.save();
          console.log('[SMS scheduler] sent', sms._id?.toString(), result.sid || '');
        } catch (error) {
          sms.status = 'failed';
          sms.lastError = error?.message || 'Failed to send SMS';
          sms.attempts = (sms.attempts || 0) + 1;
          await sms.save();
          console.error('[SMS scheduler] failed', sms._id?.toString(), sms.lastError);
        }
      }

      const staleOutbound = await SmsMessage.find({
        direction: 'outbound',
        twilioSid: { $exists: true, $ne: '' },
        $or: [
          { deliveryStatus: { $in: [...PENDING_DELIVERY_STATUSES] } },
          { deliveryStatus: { $exists: false } },
          { deliveryStatus: null },
          { deliveryStatus: '' },
        ],
        createdAt: { $lte: new Date(Date.now() - STALE_PENDING_MS) },
      })
        .sort({ createdAt: -1 })
        .limit(25)
        .lean();
      await refreshStaleDeliveryStatuses(staleOutbound, SmsMessage, { limit: 25 });
    } catch (error) {
      console.error('[SMS scheduler] tick error:', error?.message || error);
    }
  };

  setTimeout(tick, 5000);
  setInterval(tick, 60 * 1000);

  const inboundTick = async () => {
    if (inboundPollBusy) return;
    inboundPollBusy = true;
    try {
      const result = await pullInboundFromTwilio({ limit: 50, io });
      if (result?.skippedReason === 'not_configured') return;
      if (result?.imported) {
        console.log('[SMS inbound poll] imported', result.imported, 'updated', result.updated);
      }
    } catch (error) {
      console.error('[SMS inbound poll]', error?.message || error);
    } finally {
      inboundPollBusy = false;
    }
  };

  setTimeout(inboundTick, 3000);
  setInterval(inboundTick, INBOUND_POLL_MS);
}

module.exports = {
  inboundSms,
  inboundVoice,
  smsStatusCallback,
  sendSms,
  scheduleSms,
  listSms,
  getSmsDetail,
  deleteSms,
  deleteSmsConversation,
  markSmsRead,
  markJobSmsRead,
  getUnreadSmsCount,
  startSmsScheduler,
  sendSmsViaTwilio,
  sendResolvedEmployeeSms,
  twilioMediaDownload,
  sendSmsAdhoc,
  scheduleSmsAdhoc,
  getTwilioConfigStatus,
  syncInboundFromTwilio,
  streamSmsMessageMedia,
};
