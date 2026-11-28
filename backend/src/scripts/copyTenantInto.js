/* eslint-disable no-console */
/**
 * Replace one tenant's records with a full copy of another tenant.
 * Run from backend/:
 *   node src/scripts/copyTenantInto.js --source 69c1eb8214c17afd3f01ecf3 --target 69c1ebd6e4d139ef44c48fd6 --dryRun true
 *   node src/scripts/copyTenantInto.js --source <id> --target <id> --dryRun false
 *
 * Document ids are new. References inside the copy point at the new ids.
 * Logins on the copy get "+copy" before the @ so the source tenant still signs in on the original email.
 * Bank tokens, mailbox tokens, and unsent texts are not copied.
 * Files keep the same stored keys as the source. Deleting a file in either tenant removes that stored file.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

const SOURCE_DEFAULT = '69c1eb8214c17afd3f01ecf3';
const TARGET_DEFAULT = '69c1ebd6e4d139ef44c48fd6';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function bool(value, fallback) {
  if (value == null) return fallback;
  return ['1', 'true', 'yes'].includes(String(value).trim().toLowerCase());
}

function asId(value, label) {
  if (!ObjectId.isValid(String(value || ''))) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return new ObjectId(String(value));
}

function isObjectId(value) {
  return value instanceof ObjectId || value?._bsontype === 'ObjectId';
}

function copyEmail(email, taken) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  const hasDomain = at > 0;
  const local = hasDomain ? raw.slice(0, at) : raw || 'user';
  const domain = hasDomain ? raw.slice(at + 1) : '';
  const baseLocal = local.replace(/\+copy\d*$/i, '');
  const join = (suffix) => (hasDomain ? `${baseLocal}${suffix}@${domain}` : `${baseLocal}${suffix}`);
  let candidate = join('+copy');
  let n = 2;
  while (taken.has(candidate)) {
    candidate = join(`+copy${n}`);
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

function remapValue(value, idMap) {
  if (isObjectId(value)) {
    return idMap.get(String(value)) || value;
  }
  if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)) {
    const next = idMap.get(value.toLowerCase()) || idMap.get(value);
    return next ? String(next) : value;
  }
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((item) => remapValue(item, idMap));
  if (value && typeof value === 'object') {
    if (value._bsontype) return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '_id') continue;
      out[key] = remapValue(item, idMap);
    }
    return out;
  }
  return value;
}

async function dataCollections(db) {
  const listed = await db.listCollections({}, { nameOnly: true }).toArray();
  return listed
    .map((entry) => entry.name)
    .filter((name) => name && !name.startsWith('system.') && name !== 'tenants')
    .sort();
}

async function countTenant(db, name, tenantId) {
  return db.collection(name).countDocuments({ tenantId });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = bool(args.dryRun, true);
  const sourceId = asId(args.source || SOURCE_DEFAULT, 'source');
  const targetId = asId(args.target || TARGET_DEFAULT, 'target');
  if (String(sourceId) === String(targetId)) throw new Error('Source and target are the same tenant.');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing.');

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  try {
    const tenants = db.collection('tenants');
    const sourceTenant = await tenants.findOne({ _id: sourceId }, { projection: { name: 1, slug: 1 } });
    const targetTenant = await tenants.findOne({ _id: targetId }, { projection: { name: 1, slug: 1 } });
    console.log(`Source: ${sourceTenant?.name || '(no tenant document)'} / ${sourceTenant?.slug || '—'} / ${sourceId}`);
    console.log(`Target: ${targetTenant?.name || '(no tenant document)'} / ${targetTenant?.slug || '—'} / ${targetId}`);
    if (!targetTenant) throw new Error('Target tenant document does not exist. Refusing to invent one.');

    const names = await dataCollections(db);
    const active = [];
    for (const name of names) {
      const sourceCount = await countTenant(db, name, sourceId);
      const targetCount = await countTenant(db, name, targetId);
      if (!sourceCount && !targetCount) continue;
      active.push({ name, sourceCount, targetCount });
      console.log(`${name}: source ${sourceCount}, target ${targetCount}`);
    }

    if (dryRun) {
      console.log('\n[DRY RUN] No data written.');
      return;
    }

    for (const { name, targetCount } of active) {
      if (!targetCount) continue;
      const removed = await db.collection(name).deleteMany({ tenantId: targetId });
      console.log(`Cleared ${removed.deletedCount} from ${name}`);
    }

    const idMap = new Map();
    idMap.set(String(sourceId), targetId);
    for (const { name, sourceCount } of active) {
      if (!sourceCount) continue;
      const cursor = db.collection(name).find({ tenantId: sourceId }, { projection: { _id: 1 } });
      for await (const doc of cursor) {
        idMap.set(String(doc._id), new ObjectId());
      }
    }

    const takenEmails = new Set();
    let copiedUsers = 0;
    let cancelledTexts = 0;
    for (const { name, sourceCount } of active) {
      if (!sourceCount) continue;
      const cursor = db.collection(name).find({ tenantId: sourceId }).batchSize(name === 'jobmemories' ? 40 : 200);
      let batch = [];
      let inserted = 0;
      const flush = async () => {
        if (!batch.length) return;
        try {
          const result = await db.collection(name).insertMany(batch, { ordered: false });
          inserted += result.insertedCount;
        } catch (error) {
          const wrote = error?.result?.insertedCount || 0;
          inserted += wrote;
          const failed = error?.writeErrors?.length || 0;
          if (!failed) throw error;
          console.log(`${name}: ${failed} rows did not insert`);
        }
        batch = [];
      };
      for await (const doc of cursor) {
        const next = remapValue(doc, idMap);
        next._id = idMap.get(String(doc._id));
        next.tenantId = targetId;
        if (name === 'users') {
          next.email = copyEmail(next.email, takenEmails);
          copiedUsers += 1;
        }
        if (name === 'scheduledsms' && next.status === 'scheduled') {
          next.status = 'cancelled';
          next.lastError = 'Copied tenant. This text was not sent again.';
          cancelledTexts += 1;
        }
        batch.push(next);
        if (batch.length >= (name === 'jobmemories' ? 40 : 200)) await flush();
      }
      await flush();
      console.log(`Copied ${inserted} -> ${name}`);
    }

    const sourceFull = await tenants.findOne({ _id: sourceId });
    const setting = {};
    if (sourceFull) {
      for (const key of [
        'logo',
        'logoLight',
        'logoDark',
        'pipelineStageOverrides',
        'estimateDocumentSettings',
        'pipelineSmsTemplates',
        'cannedSmsTemplates',
        'adSpend',
      ]) {
        if (sourceFull[key] != null) setting[key] = remapValue(sourceFull[key], idMap);
      }
      if (sourceFull.paymentNotificationSettings) {
        setting.paymentNotificationSettings = remapValue(sourceFull.paymentNotificationSettings, idMap);
      }
      const link = sourceFull.outlookLink || {};
      setting.outlookLink = {
        mailbox: link.mailbox || '',
        mailboxName: link.mailboxName || '',
        teamSenders: link.teamSenders || [],
        subjectHints: link.subjectHints || ['worksheet'],
        refreshToken: '',
        accessToken: '',
        accessTokenExpiresAt: null,
        lastSyncError: '',
      };
    }
    setting.plaidLink = {};
    await tenants.updateOne({ _id: targetId }, { $set: setting });

    console.log('\nCopy complete.');
    console.log(`Users on the copy: ${copiedUsers}. Sign in with the same password and +copy before the @.`);
    console.log(`Unsent texts cancelled on the copy: ${cancelledTexts}.`);
    console.log('Bank connection and mailbox tokens were not copied.');
    console.log('File records point at the same stored files as the source.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('copyTenantInto failed:', error?.message || error);
    process.exit(1);
  });
}
