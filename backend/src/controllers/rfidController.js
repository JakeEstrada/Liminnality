const RfidTag = require('../models/RfidTag');
const RfidPin = require('../models/RfidPin');
const RfidPhone = require('../models/RfidPhone');
const RfidScan = require('../models/RfidScan');
const RfidEmployeeProfile = require('../models/RfidEmployeeProfile');
const RfidTimesheetWeek = require('../models/RfidTimesheetWeek');
const {
  publishRfidScanCreated,
  publishRfidTagUpserted,
  publishRfidTagDeleted,
  publishRfidPinUpserted,
  publishRfidPinDeleted,
  publishRfidPhoneUpserted,
  publishRfidPhoneDeleted,
  publishRfidTimesheetUpdated,
  publishRfidEmployeeProfileUpdated,
} = require('../services/eventBus');
const { getTenantContext, runWithTenantContext } = require('../middleware/tenantContext');
const { computeWeekTotalHours, sanitizeManualByDay } = require('../services/rfidWeekHours');
const { shouldStoreHourlyRate } = require('../utils/hourlyRate');

function normalizeUid(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/\s+/g, '');
}

function normalizePin(raw) {
  const s = String(raw || '').trim().replace(/\D/g, '');
  if (s.length !== 4) return '';
  return s;
}

function last10Digits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return '';
}

function normalizePhone(raw) {
  const digits = last10Digits(raw);
  if (!digits) return null;
  return { phone: `+1${digits}`, phoneDigits: digits };
}

function phoneMatchValues(raw) {
  const parsed = normalizePhone(raw);
  const digits = last10Digits(raw);
  const values = new Set();
  if (parsed) {
    values.add(parsed.phone);
    values.add(parsed.phoneDigits);
  }
  if (digits) {
    values.add(digits);
    values.add(`+${digits}`);
    values.add(`1${digits}`);
    values.add(`+1${digits}`);
  }
  return [...values].filter(Boolean);
}

function normalizeEmployeeKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeTimeToken(raw, fallback = '0') {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits || digits === '0') return fallback;
  if (digits.length <= 4) return digits;
  return digits.slice(0, 4);
}

function bodyHas(body, key) {
  return body != null && Object.prototype.hasOwnProperty.call(body, key) && body[key] != null && String(body[key]).trim() !== '';
}

function cleanRosterName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

async function recordScan(req, res) {
  try {
    const pin = normalizePin(req.body?.pin);
    const uid = normalizeUid(req.body?.uid);

    if (pin) {
      return recordPinScan(req, res, pin);
    }

    if (!uid) {
      return res.status(400).json({ error: 'uid or pin is required' });
    }

    const tag = await RfidTag.findOne({ uid, isActive: { $ne: false } });
    const bodyName = String(req.body?.displayName || req.body?.name || '').trim();
    const displayName =
      bodyName || (tag?.displayName ? String(tag.displayName).trim() : '') || `Unknown tag (${uid})`;

    const scannedAtRaw = req.body?.scannedAt;
    const scannedAt = scannedAtRaw ? new Date(scannedAtRaw) : new Date();
    if (Number.isNaN(scannedAt.getTime())) {
      return res.status(400).json({ error: 'Invalid scannedAt' });
    }

    const scan = await RfidScan.create({
      uid,
      displayName,
      rfidTagId: tag?._id || undefined,
      scannedAt,
      source: String(req.body?.source || 'device').trim() || 'device',
      deviceLabel: String(req.body?.deviceLabel || req.body?.device || '').trim(),
    });

    const io = req.app.get('io');
    const scanDoc = scan.toObject ? scan.toObject() : scan;
    if (!scanDoc.tenantId) {
      const { tenantId } = getTenantContext();
      if (tenantId) scanDoc.tenantId = tenantId;
    }
    publishRfidScanCreated(io, scanDoc, {
      knownTag: Boolean(tag),
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    let weekHours = null;
    try {
      weekHours = await computeWeekTotalHours(displayName);
    } catch (weekErr) {
      console.error('computeWeekTotalHours error:', weekErr?.message || weekErr);
    }

    return res.status(201).json({
      success: true,
      scan: {
        _id: scan._id,
        uid: scan.uid,
        displayName: scan.displayName,
        scannedAt: scan.scannedAt,
        knownTag: Boolean(tag),
        weekTotalHours: weekHours?.weekTotalHours ?? null,
        weekDays: weekHours?.weekDays ?? null,
        payPeriodId: weekHours?.periodId ?? null,
      },
    });
  } catch (error) {
    console.error('recordScan error:', error?.message || error);
    return res.status(500).json({ error: error.message || 'Failed to record scan' });
  }
}

async function recordPinScan(req, res, pin) {
  try {
    const pinEntry = await RfidPin.findOne({ pin, isActive: { $ne: false } });
    const bodyName = String(req.body?.displayName || req.body?.name || '').trim();
    const displayName =
      bodyName ||
      (pinEntry?.displayName ? String(pinEntry.displayName).trim() : '') ||
      `Unknown PIN (${pin})`;

    const scannedAtRaw = req.body?.scannedAt;
    const scannedAt = scannedAtRaw ? new Date(scannedAtRaw) : new Date();
    if (Number.isNaN(scannedAt.getTime())) {
      return res.status(400).json({ error: 'Invalid scannedAt' });
    }

    const scan = await RfidScan.create({
      uid: `PIN-${pin}`,
      pin,
      displayName,
      rfidPinId: pinEntry?._id || undefined,
      scannedAt,
      source: String(req.body?.source || 'device').trim() || 'device',
      deviceLabel: String(req.body?.deviceLabel || req.body?.device || '').trim(),
    });

    const io = req.app.get('io');
    const scanDoc = scan.toObject ? scan.toObject() : scan;
    if (!scanDoc.tenantId) {
      const { tenantId } = getTenantContext();
      if (tenantId) scanDoc.tenantId = tenantId;
    }
    publishRfidScanCreated(io, scanDoc, {
      knownPin: Boolean(pinEntry),
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    let weekHours = null;
    try {
      weekHours = await computeWeekTotalHours(displayName);
    } catch (weekErr) {
      console.error('computeWeekTotalHours error:', weekErr?.message || weekErr);
    }

    return res.status(201).json({
      success: true,
      scan: {
        _id: scan._id,
        uid: scan.uid,
        pin: scan.pin,
        displayName: scan.displayName,
        scannedAt: scan.scannedAt,
        knownPin: Boolean(pinEntry),
        weekTotalHours: weekHours?.weekTotalHours ?? null,
        weekDays: weekHours?.weekDays ?? null,
        payPeriodId: weekHours?.periodId ?? null,
      },
    });
  } catch (error) {
    console.error('recordPinScan error:', error?.message || error);
    return res.status(500).json({ error: error.message || 'Failed to record PIN scan' });
  }
}

async function listScans(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);
    const page = Math.max(Number(req.query?.page) || 1, 1);
    const uid = normalizeUid(req.query?.uid);
    const q = {};
    if (uid) q.uid = uid;

    const fromRaw = req.query?.from;
    const toRaw = req.query?.to;
    if (fromRaw || toRaw) {
      q.scannedAt = {};
      if (fromRaw) {
        const from = new Date(String(fromRaw));
        if (!Number.isNaN(from.getTime())) q.scannedAt.$gte = from;
      }
      if (toRaw) {
        const to = new Date(String(toRaw));
        if (!Number.isNaN(to.getTime())) q.scannedAt.$lt = to;
      }
      if (Object.keys(q.scannedAt).length === 0) delete q.scannedAt;
    }

    const [scans, total] = await Promise.all([
      RfidScan.find(q)
        .sort({ scannedAt: -1 })
        .limit(limit)
        .skip((page - 1) * limit)
        .lean(),
      RfidScan.countDocuments(q),
    ]);

    return res.json({
      scans,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function listTags(req, res) {
  try {
    const tags = await RfidTag.find({}).sort({ displayName: 1 }).lean();
    return res.json({ tags });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function listPins(req, res) {
  try {
    const pins = await RfidPin.find({}).sort({ displayName: 1 }).lean();
    return res.json({ pins });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function listPhones(req, res) {
  try {
    const phones = await RfidPhone.find({}).sort({ displayName: 1 }).lean();
    return res.json({ phones });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function upsertTag(req, res) {
  try {
    const uid = normalizeUid(req.body?.uid);
    const displayName = String(req.body?.displayName || req.body?.name || '').trim();
    if (!uid) return res.status(400).json({ error: 'uid is required' });
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const notes = String(req.body?.notes || '').trim();
    const employeeUserId = req.body?.employeeUserId || null;
    const isActive = req.body?.isActive !== false;

    const tag = await RfidTag.findOneAndUpdate(
      { uid },
      {
        uid,
        displayName,
        notes,
        employeeUserId: employeeUserId || undefined,
        isActive,
      },
      { upsert: true, new: true, runValidators: true }
    );

    const io = req.app.get('io');
    const tagDoc = tag.toObject ? tag.toObject() : tag;
    publishRfidTagUpserted(io, tagDoc, {
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    return res.status(200).json({ tag });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'This UID is already registered for your organization' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function upsertPin(req, res) {
  try {
    const pin = normalizePin(req.body?.pin);
    const displayName = String(req.body?.displayName || req.body?.name || '').trim();
    if (!pin) return res.status(400).json({ error: 'pin must be exactly 4 digits' });
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const notes = String(req.body?.notes || '').trim();
    const employeeUserId = req.body?.employeeUserId || null;
    const isActive = req.body?.isActive !== false;

    const pinEntry = await RfidPin.findOneAndUpdate(
      { pin },
      {
        pin,
        displayName,
        notes,
        employeeUserId: employeeUserId || undefined,
        isActive,
      },
      { upsert: true, new: true, runValidators: true }
    );

    const io = req.app.get('io');
    const pinDoc = pinEntry.toObject ? pinEntry.toObject() : pinEntry;
    publishRfidPinUpserted(io, pinDoc, {
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    return res.status(200).json({ pin: pinEntry });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'This PIN is already registered for your organization' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function deleteTag(req, res) {
  try {
    const tag = await RfidTag.findByIdAndDelete(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });

    const io = req.app.get('io');
    const tagDoc = tag.toObject ? tag.toObject() : tag;
    publishRfidTagDeleted(io, tagDoc, {
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function upsertPhone(req, res) {
  try {
    const parsed = normalizePhone(req.body?.phone || req.body?.number);
    const displayName = String(req.body?.displayName || req.body?.name || '').trim();
    if (!parsed) return res.status(400).json({ error: 'phone must be a 10-digit number' });
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const { tenantId } = getTenantContext();
    const notes = String(req.body?.notes || '').trim();
    const employeeUserId = req.body?.employeeUserId || null;
    const isActive = req.body?.isActive !== false;

    const phoneEntry = await RfidPhone.findOneAndUpdate(
      { phoneDigits: parsed.phoneDigits },
      {
        phone: parsed.phone,
        phoneDigits: parsed.phoneDigits,
        displayName,
        notes,
        employeeUserId: employeeUserId || undefined,
        isActive,
        ...(tenantId ? { tenantId } : {}),
      },
      { upsert: true, new: true, runValidators: true }
    );

    const io = req.app.get('io');
    const phoneDoc = phoneEntry.toObject ? phoneEntry.toObject() : phoneEntry;
    publishRfidPhoneUpserted(io, phoneDoc, {
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    return res.status(200).json({ phone: phoneEntry });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'This number is already registered for your organization' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function deletePhone(req, res) {
  try {
    const phoneEntry = await RfidPhone.findByIdAndDelete(req.params.id);
    if (!phoneEntry) return res.status(404).json({ error: 'Number not found' });

    const io = req.app.get('io');
    const phoneDoc = phoneEntry.toObject ? phoneEntry.toObject() : phoneEntry;
    publishRfidPhoneDeleted(io, phoneDoc, {
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function findActivePhoneByFrom(from) {
  const values = phoneMatchValues(from);
  const digits = last10Digits(from);
  if (!values.length && !digits) return null;
  const query = { isActive: { $ne: false } };
  if (digits) {
    query.$or = [{ phone: { $in: values } }, { phoneDigits: digits }];
  } else {
    query.phone = { $in: values };
  }
  return RfidPhone.findOne(query).setOptions({ bypassTenant: true });
}

async function recordSmsPunch({ phoneEntry, body, scannedAt, io }) {
  const digits = String(phoneEntry.phoneDigits || last10Digits(phoneEntry.phone) || '').trim();
  const displayName = String(phoneEntry.displayName || '').trim() || `Unknown number (${digits || 'sms'})`;
  const note = String(body || '').trim().slice(0, 80);
  const when = scannedAt instanceof Date ? scannedAt : new Date();
  if (Number.isNaN(when.getTime())) {
    throw new Error('Invalid scannedAt');
  }

  const scan = await RfidScan.create({
    uid: `SMS-${digits || 'unknown'}`,
    phone: phoneEntry.phone || '',
    rfidPhoneId: phoneEntry._id || undefined,
    displayName,
    scannedAt: when,
    source: 'sms',
    deviceLabel: note || 'sms',
  });

  const scanDoc = scan.toObject ? scan.toObject() : scan;
  if (!scanDoc.tenantId) {
    const { tenantId } = getTenantContext();
    if (tenantId) scanDoc.tenantId = tenantId;
  }
  publishRfidScanCreated(io, scanDoc, { knownPhone: true });

  let weekHours = null;
  try {
    weekHours = await computeWeekTotalHours(displayName);
  } catch (weekErr) {
    console.error('computeWeekTotalHours error:', weekErr?.message || weekErr);
  }

  return { scan: scanDoc, weekHours };
}

function isSmsClockPunchBody(raw) {
  const text = String(raw ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (/^\s*$/.test(text)) return true;
  const token = text.trim().toLowerCase().replace(/[!?.,]+$/g, '');
  return token === '' || token === '.' || token === 'in' || token === 'out';
}

function punchKindFromBody(raw) {
  const token = String(raw ?? '').trim().toLowerCase();
  if (token === 'in') return 'in';
  if (token === 'out') return 'out';
  return 'punch';
}

function formatShopPunchTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.RFID_SHOP_TIMEZONE || 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date instanceof Date ? date : new Date(date));
}

function smsPunchConfirmation(kind, when) {
  const time = formatShopPunchTime(when);
  if (kind === 'in') return `Received. Clocked in at ${time}.`;
  if (kind === 'out') return `Received. Clocked out at ${time}.`;
  return `Received. Punch logged at ${time}.`;
}

async function hasRecentSmsPunch(phoneEntry, when) {
  const digits = String(phoneEntry.phoneDigits || last10Digits(phoneEntry.phone) || '').trim();
  if (!digits) return false;
  const at = when instanceof Date ? when : new Date(when || Date.now());
  if (Number.isNaN(at.getTime())) return false;
  const existing = await RfidScan.findOne({
    uid: `SMS-${digits}`,
    scannedAt: {
      $gte: new Date(at.getTime() - 2 * 60 * 1000),
      $lte: new Date(at.getTime() + 2 * 60 * 1000),
    },
  }).setOptions({ bypassTenant: true });
  return Boolean(existing);
}

async function tryRecordSmsPunch({ from, body, io, tenantId, scannedAt } = {}) {
  if (!isSmsClockPunchBody(body)) return null;
  const phoneEntry = await findActivePhoneByFrom(from);
  if (!phoneEntry) {
    console.log('[SMS punch] no registered number for', last10Digits(from) || from);
    return null;
  }
  const tid = String(phoneEntry.tenantId || tenantId || '');
  if (!tid) {
    console.log('[SMS punch] registered number missing tenant', phoneEntry.displayName);
    return null;
  }
  const when = scannedAt ? new Date(scannedAt) : new Date();
  return runWithTenantContext({ tenantId: tid }, async () => {
    if (await hasRecentSmsPunch(phoneEntry, when)) {
      return { scan: null, confirmation: '' };
    }
    const result = await recordSmsPunch({
      phoneEntry,
      body,
      scannedAt: Number.isNaN(when.getTime()) ? new Date() : when,
      io,
    });
    console.log('[SMS punch] saved', result?.scan?.displayName, punchKindFromBody(body));
    return {
      ...result,
      confirmation: smsPunchConfirmation(punchKindFromBody(body), result?.scan?.scannedAt || when),
    };
  });
}

async function deletePin(req, res) {
  try {
    const pinEntry = await RfidPin.findByIdAndDelete(req.params.id);
    if (!pinEntry) return res.status(404).json({ error: 'PIN not found' });

    const io = req.app.get('io');
    const pinDoc = pinEntry.toObject ? pinEntry.toObject() : pinEntry;
    publishRfidPinDeleted(io, pinDoc, {
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function listEmployeeProfiles(req, res) {
  try {
    const profiles = await RfidEmployeeProfile.find({}).sort({ displayName: 1 }).lean();
    return res.json({ profiles });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function upsertEmployeeProfile(req, res) {
  try {
    const employeeKey = normalizeEmployeeKey(req.params.employeeKey || req.body?.employeeKey);
    const displayName = String(req.body?.displayName || req.body?.name || '').trim();
    if (!employeeKey) return res.status(400).json({ error: 'employeeKey is required' });
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const shiftIn = normalizeTimeToken(req.body?.shiftIn, '600');
    const shiftOut = normalizeTimeToken(req.body?.shiftOut, '1430');
    const breakMinutes = Math.min(
      480,
      Math.max(0, Number(req.body?.breakMinutes ?? 30) || 0),
    );
    const ratePerHour = String(req.body?.ratePerHour ?? '').trim();
    const profileUpdate = {
      employeeKey,
      displayName,
    };
    // Roster add/remove sends the name only. Leave a shift and rate that are already saved.
    if (bodyHas(req.body, 'shiftIn')) profileUpdate.shiftIn = shiftIn;
    if (bodyHas(req.body, 'shiftOut')) profileUpdate.shiftOut = shiftOut;
    if (bodyHas(req.body, 'breakMinutes')) profileUpdate.breakMinutes = breakMinutes;
    if (typeof req.body?.onRoster === 'boolean') profileUpdate.onRoster = req.body.onRoster;
    // A blank rate is the form's empty state. Leave a rate already saved on the employee.
    if (shouldStoreHourlyRate(ratePerHour)) profileUpdate.ratePerHour = ratePerHour;

    const profile = await RfidEmployeeProfile.findOneAndUpdate(
      { employeeKey },
      profileUpdate,
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );

    const io = req.app.get('io');
    const profileDoc = profile.toObject ? profile.toObject() : profile;
    publishRfidEmployeeProfileUpdated(io, profileDoc, {
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    return res.json({ profile: profileDoc });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function addRosterEmployees(req, res) {
  try {
    const incoming = Array.isArray(req.body?.names) ? req.body.names : [];
    const names = [];
    const seen = new Set();
    for (const raw of incoming) {
      const name = cleanRosterName(raw);
      const key = normalizeEmployeeKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push({ key, name });
      if (names.length >= 200) break;
    }
    if (names.length === 0) {
      return res.status(400).json({ error: 'Add at least one employee name' });
    }

    const io = req.app.get('io');
    const profiles = [];
    for (const { key, name } of names) {
      const existing = await RfidEmployeeProfile.findOne({ employeeKey: key }).lean();
      const profile = await RfidEmployeeProfile.findOneAndUpdate(
        { employeeKey: key },
        {
          employeeKey: key,
          displayName: existing?.displayName || name,
          onRoster: true,
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
      const profileDoc = profile.toObject ? profile.toObject() : profile;
      publishRfidEmployeeProfileUpdated(io, profileDoc, {
        sourceSocketId: req.headers['x-socket-id'] || null,
      });
      profiles.push(profileDoc);
    }

    return res.json({ profiles, count: profiles.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getKioskWeekSummary(req, res) {
  try {
    const displayName = String(req.query?.displayName || req.query?.name || '').trim();
    if (!displayName) {
      return res.status(400).json({ error: 'displayName is required' });
    }

    const weekHours = await computeWeekTotalHours(displayName);
    if (!weekHours) {
      return res.status(404).json({ error: 'Employee not found or not mapped' });
    }

    return res.json({
      weekTotalHours: weekHours.weekTotalHours ?? null,
      weekDays: weekHours.weekDays ?? null,
      periodId: weekHours.periodId ?? null,
      employeeKey: weekHours.employeeKey ?? null,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getTimesheetWeek(req, res) {
  try {
    const employeeKey = normalizeEmployeeKey(req.params.employeeKey);
    const periodId = String(req.params.periodId || '').trim();
    if (!employeeKey || !periodId) {
      return res.status(400).json({ error: 'employeeKey and periodId are required' });
    }

    const timesheet = await RfidTimesheetWeek.findOne({ employeeKey, periodId }).lean();
    return res.json({ timesheet: timesheet || null });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function upsertTimesheetWeek(req, res) {
  try {
    const employeeKey = normalizeEmployeeKey(req.params.employeeKey || req.body?.employeeKey);
    const periodId = String(req.params.periodId || req.body?.periodId || '').trim();
    if (!employeeKey || !periodId) {
      return res.status(400).json({ error: 'employeeKey and periodId are required' });
    }

    const workHours = Array.isArray(req.body?.workHours) ? req.body.workHours : [];
    const receipts = Array.isArray(req.body?.receipts) ? req.body.receipts : [];
    const additionalHours = Array.isArray(req.body?.additionalHours) ? req.body.additionalHours : [];
    const travelMiles = Array.isArray(req.body?.travelMiles) ? req.body.travelMiles : [];
    const ratePerHour = String(req.body?.ratePerHour ?? '').trim();
    const manualByDay = sanitizeManualByDay(
      req.body?.manualByDay && typeof req.body.manualByDay === 'object' ? req.body.manualByDay : {},
      workHours,
    );
    const timesheetUpdate = {
      employeeKey,
      periodId,
      workHours,
      receipts,
      additionalHours,
      travelMiles,
      manualByDay,
    };
    // Hours saves and the scan heal often send a blank rate. Keep the rate already on this week.
    if (shouldStoreHourlyRate(ratePerHour)) timesheetUpdate.ratePerHour = ratePerHour;

    const timesheet = await RfidTimesheetWeek.findOneAndUpdate(
      { employeeKey, periodId },
      timesheetUpdate,
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );

    const io = req.app.get('io');
    const timesheetDoc = timesheet.toObject ? timesheet.toObject() : timesheet;
    publishRfidTimesheetUpdated(io, timesheetDoc, {
      sourceSocketId: req.headers['x-socket-id'] || null,
    });

    return res.json({ timesheet: timesheetDoc });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  recordScan,
  listScans,
  listTags,
  listPins,
  listPhones,
  upsertTag,
  upsertPin,
  upsertPhone,
  deleteTag,
  deletePin,
  deletePhone,
  tryRecordSmsPunch,
  findActivePhoneByFrom,
  listEmployeeProfiles,
  upsertEmployeeProfile,
  addRosterEmployees,
  getKioskWeekSummary,
  getTimesheetWeek,
  upsertTimesheetWeek,
};
