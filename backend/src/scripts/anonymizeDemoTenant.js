/**
 * Anonymize the demo shop only.
 * Usage: node src/scripts/anonymizeDemoTenant.js --dryRun true|false
 * Dry run is the default. This refuses every tenant except the demo copy.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const {
  anonymizeValue,
  buildDemoContext,
  collectFromValue,
  tenDigits,
} = require('../utils/demoAnonymize');

const DEMO_ID = '69c1ebd6e4d139ef44c48fd6';
const SOURCE_ID = '69c1eb8214c17afd3f01ecf3';
const MONEY_KEYS = new Set([
  'amount', 'unitPrice', 'total', 'valueEstimated', 'valueContracted',
  'paidAmount', 'percentage', 'quantity', 'depositRequired', 'depositReceived',
  'contractTotal', 'price', 'balance',
]);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function emptyBucket() {
  return { names: [], phones: [], streets: [], emails: [], protectedEmails: [] };
}

function walkNumbers(value, key, into) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (key === 'lat' || key === 'lng' || key === 'latitude' || key === 'longitude') into.coords.push(value);
    if (MONEY_KEYS.has(key)) into.money.push(value);
    if (key === 'ratePerHour') into.rates.push(String(value));
    return;
  }
  if (typeof value === 'string' && key === 'ratePerHour') into.rates.push(value);
  if (!value || typeof value !== 'object') return;
  if (value._bsontype === 'ObjectId' || value instanceof Date) return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkNumbers(item, key, into));
    return;
  }
  for (const [childKey, child] of Object.entries(value)) walkNumbers(child, childKey, into);
}

function numberStamp(groups) {
  const into = { coords: [], money: [], rates: [] };
  for (const docs of groups) docs.forEach((doc) => walkNumbers(doc, '', into));
  return JSON.stringify(into);
}

function phoneProblems(groups) {
  let bad = 0;
  function walk(value, key) {
    if (typeof value === 'string' && /phone|mobile/i.test(key || '')) {
      const ten = tenDigits(value);
      if (ten && ten.slice(3, 6) !== '555') bad += 1;
    } else if (value && typeof value === 'object' && value._bsontype !== 'ObjectId' && !(value instanceof Date)) {
      if (Array.isArray(value)) value.forEach((item) => walk(item, key));
      else Object.entries(value).forEach(([childKey, child]) => walk(child, childKey));
    }
  }
  for (const docs of groups) docs.forEach((doc) => walk(doc, ''));
  return bad;
}

function stringStamp(value, key = '') {
  if (typeof value === 'string') return `${key}:${value}`;
  if (!value || typeof value !== 'object' || value._bsontype === 'ObjectId' || value instanceof Date) return '';
  if (Array.isArray(value)) return value.map((item) => stringStamp(item, key)).join('\n');
  return Object.entries(value).map(([childKey, child]) => stringStamp(child, childKey)).join('\n');
}

async function sourceStamp(db, sourceId) {
  const rows = await db.collection('customers').find({ tenantId: sourceId }).project({ updatedAt: 1 }).toArray();
  const max = rows.reduce((latest, row) => Math.max(latest, new Date(row.updatedAt || 0).getTime() || 0), 0);
  return `${rows.length}:${max}`;
}

async function main() {
  const dryRun = String(arg('dryRun', 'true')) !== 'false';
  if (DEMO_ID === SOURCE_ID) throw new Error('Demo id matches the real shop');
  const demoId = new ObjectId(DEMO_ID);
  const sourceId = new ObjectId(SOURCE_ID);
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const beforeSource = await sourceStamp(db, sourceId);

  const loaded = [];
  const names = await db.listCollections().toArray();
  for (const info of names) {
    if (info.name.startsWith('system.')) continue;
    const collection = db.collection(info.name);
    if (info.name === 'tenants') {
      const doc = await collection.findOne({ _id: demoId });
      if (doc) loaded.push({ name: info.name, docs: [doc] });
      continue;
    }
    const docs = await collection.find({ tenantId: demoId }).toArray();
    if (docs.length) loaded.push({ name: info.name, docs });
  }

  const bucket = emptyBucket();
  for (const group of loaded) {
    for (const doc of group.docs) collectFromValue(doc, bucket, '', group.name);
  }
  const ctx = buildDemoContext(bucket);
  const beforeStamp = numberStamp(loaded.map((group) => group.docs));

  const changed = [];
  for (const group of loaded) {
    const nextDocs = group.docs.map((doc) => anonymizeValue(doc, ctx, '', group.name));
    changed.push({ name: group.name, before: group.docs, docs: nextDocs });
  }

  const folderGroup = changed.find((group) => group.name === 'documentfolders');
  if (folderGroup) {
    const existing = await db.collection('documentfolders').find({}).project({ parentId: 1, name: 1, tenantId: 1 }).toArray();
    const taken = new Set();
    for (const folder of existing) {
      if (String(folder.tenantId) === DEMO_ID) continue;
      taken.add(`${String(folder.parentId || '')}:${folder.name}`);
    }
    for (const folder of folderGroup.docs) {
      let name = folder.name;
      let n = 2;
      while (taken.has(`${String(folder.parentId || '')}:${name}`)) {
        name = `${folder.name} (${n})`;
        n += 1;
      }
      folder.name = name;
      taken.add(`${String(folder.parentId || '')}:${name}`);
    }
  }

  const afterStamp = numberStamp(changed.map((group) => group.docs));
  const badPhones = phoneProblems(changed.map((group) => group.docs));
  if (beforeStamp !== afterStamp) throw new Error('Prices or coordinates would change. Nothing was written.');
  if (badPhones) throw new Error(`${badPhones} phone fields would still show a real exchange. Nothing was written.`);

  let gateCleared = 0;
  let writes = 0;
  const byCollection = [];
  for (const group of changed) {
    let count = 0;
    for (let i = 0; i < group.docs.length; i += 1) {
      if (stringStamp(group.before[i]) !== stringStamp(group.docs[i])) {
        count += 1;
        if (group.before[i].gateCode && !group.docs[i].gateCode) gateCleared += 1;
      }
    }
    writes += count;
    byCollection.push(`${group.name} ${count}/${group.docs.length}`);
  }

  const login = changed.find((group) => group.name === 'users')?.docs.find((doc) => doc.email === 'scww+copy');
  if (!login) throw new Error('scww+copy would disappear. Nothing was written.');

  console.log(dryRun ? 'Dry run' : 'Writing demo shop');
  console.log(byCollection.join('\n'));
  console.log(`names ${bucket.names.length} streets ${new Set(bucket.streets).size} phones ${ctx.phoneMap.size} collisions ${ctx.phoneCollisions}`);
  console.log(`documents changed ${writes}`);
  console.log(`gate codes cleared ${gateCleared}`);
  console.log('prices and coordinates unchanged');
  console.log('login kept: scww+copy');

  if (dryRun) {
    await mongoose.disconnect();
    return;
  }

  for (const group of changed) {
    const ops = [];
    for (let i = 0; i < group.docs.length; i += 1) {
      if (stringStamp(group.before[i]) === stringStamp(group.docs[i])) continue;
      const doc = group.docs[i];
      const filter = group.name === 'tenants'
        ? { _id: demoId }
        : { _id: doc._id, tenantId: demoId };
      if (String(filter.tenantId || filter._id) !== DEMO_ID) throw new Error('refusing write outside the demo shop');
      ops.push({ replaceOne: { filter, replacement: doc } });
    }
    for (let i = 0; i < ops.length; i += 200) {
      if (ops.slice(i, i + 200).length) {
        await db.collection(group.name).bulkWrite(ops.slice(i, i + 200), { ordered: true });
      }
    }
  }

  const afterSource = await sourceStamp(db, sourceId);
  if (afterSource !== beforeSource) throw new Error('The real shop changed. Stop and check the demo write.');
  console.log('real shop unchanged');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message || error);
  try { await mongoose.disconnect(); } catch (disconnectError) { /* already closed */ }
  process.exit(1);
});
