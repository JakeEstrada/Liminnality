/* eslint-disable no-console */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Tenant = require('../models/Tenant');

const COLLECTIONS = [
  'users',
  'customers',
  'pipelinelayouts',
  'jobs',
  'tasks',
  'appointments',
  'documentfolders',
  'files',
  'bills',
  'activities',
  'estimates',
  'invoices',
  'contracts',
  'documentsequences',
  'plaidregistercaches',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function bool(v, fallback = false) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function toObjectId(v) {
  if (!v) return null;
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return null;
  }
}

function setAtPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function getAtPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function remapSingleId(raw, map) {
  if (!raw || !map) return raw;
  const key = String(raw);
  return map.get(key) || raw;
}

function remapPath(doc, path, map) {
  const current = getAtPath(doc, path);
  if (current == null) return;
  if (Array.isArray(current)) {
    setAtPath(
      doc,
      path,
      current.map((x) => remapSingleId(x, map))
    );
    return;
  }
  setAtPath(doc, path, remapSingleId(current, map));
}

function anonymizeUser(doc, idx, context = {}) {
  const n = idx + 1;
  doc.name = `Demo User ${n}`;
  const targetSlugPart = String(context.targetSlug || 'tenant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'tenant';
  const idSuffix = String(doc?._id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-10) || String(n);
  doc.email = `demo.${targetSlugPart}.${idSuffix}@example.com`;
  doc.mobile = '';
  doc.previousPhoneNumbers = [];
  doc.address = '';
  doc.password = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
  doc.isActive = true;
  doc.isPending = false;
}

function anonymizeAddress(address, n) {
  if (!address || typeof address !== 'object') return;
  address.street = `${100 + (n % 800)} Demo Street`;
  if ('fullAddress' in address) address.fullAddress = `${address.street}`;
}

function anonymizeCustomer(doc, idx) {
  const n = idx + 1;
  doc.name = `Customer ${n}`;
  doc.primaryPhone = `555-010${String(n % 10)}`;
  doc.primaryEmail = `customer.${n}@example.com`;
  doc.notes = '';
  doc.gateCode = '';
  if (Array.isArray(doc.phones)) doc.phones = doc.phones.map(() => doc.primaryPhone);
  if (Array.isArray(doc.emails)) doc.emails = doc.emails.map(() => doc.primaryEmail);
  if (Array.isArray(doc.contactPhones)) {
    doc.contactPhones = doc.contactPhones.map((p, i) => ({ ...p, value: `555-01${String(n).padStart(2, '0')}${i}` }));
  }
  if (Array.isArray(doc.contactEmails)) {
    doc.contactEmails = doc.contactEmails.map((e, i) => ({ ...e, value: `contact.${n}.${i}@example.com` }));
  }
  anonymizeAddress(doc.address, n);
  if (Array.isArray(doc.addresses)) doc.addresses.forEach((address) => anonymizeAddress(address, n));
}

function anonymizeJob(doc, idx) {
  const n = idx + 1;
  doc.title = `Job ${n}`;
  doc.description = '';
  doc.commissionLog = undefined;
  if (doc.jobContact) {
    doc.jobContact.phone = `555-030${String(n % 10)}`;
    doc.jobContact.email = `job.contact.${n}@example.com`;
  }
  anonymizeAddress(doc.jobAddress, n);
  if (doc.geo) doc.geo.sourceAddress = '';
  if (Array.isArray(doc.notes)) {
    doc.notes = doc.notes.map((note) => ({
      ...note,
      content: 'Note',
      createdByName: 'Demo User',
    }));
  }
}

function anonymizeAppointment(doc, idx) {
  const n = idx + 1;
  if (doc.customerName) doc.customerName = `Customer ${n}`;
  if (doc.customerPhone) doc.customerPhone = `555-040${String(n % 10)}`;
  if (doc.customerEmail) doc.customerEmail = `appointment.${n}@example.com`;
}

function anonymizeByCollection(name, doc, idx, context = {}) {
  switch (name) {
    case 'users':
      anonymizeUser(doc, idx, context);
      break;
    case 'customers':
      anonymizeCustomer(doc, idx);
      break;
    case 'jobs':
      anonymizeJob(doc, idx);
      break;
    case 'appointments':
      anonymizeAppointment(doc, idx);
      break;
    case 'activities':
      doc.note = doc.note ? 'Activity note' : '';
      doc.changes = undefined;
      break;
    case 'bills':
      doc.title = `Bill ${idx + 1}`;
      doc.description = '';
      break;
    case 'estimates':
    case 'invoices':
    case 'contracts':
      doc.description = '';
      if ('notes' in doc) doc.notes = '';
      break;
    case 'files': {
      const ext = String(doc.originalName || '').includes('.')
        ? `.${String(doc.originalName).split('.').pop()}`
        : '';
      doc.originalName = `file-${idx + 1}${ext}`;
      break;
    }
    default:
      break;
  }
}

function remapReferences(collectionName, doc, maps) {
  const userMap = maps.users;
  const customerMap = maps.customers;
  const jobMap = maps.jobs;
  const taskMap = maps.tasks;
  const fileMap = maps.files;
  const folderMap = maps.documentfolders;
  const estimateMap = maps.estimates;
  const invoiceMap = maps.invoices;
  const contractMap = maps.contracts;
  const pipelineLayoutMap = maps.pipelinelayouts;

  switch (collectionName) {
    case 'users':
      remapPath(doc, 'createdBy', userMap);
      break;
    case 'customers':
      remapPath(doc, 'createdBy', userMap);
      break;
    case 'pipelinelayouts':
      break;
    case 'jobs':
      remapPath(doc, 'customerId', customerMap);
      remapPath(doc, 'assignedTo', userMap);
      remapPath(doc, 'takeoff.completedBy', userMap);
      remapPath(doc, 'notes', null);
      if (Array.isArray(doc.notes)) {
        doc.notes = doc.notes.map((n) => ({
          ...n,
          createdBy: remapSingleId(n.createdBy, userMap),
        }));
      }
      remapPath(doc, 'archivedBy', userMap);
      remapPath(doc, 'completedClosedOutBy', userMap);
      remapPath(doc, 'createdBy', userMap);
      remapPath(doc, 'pipelineLayoutId', pipelineLayoutMap);
      remapPath(doc, 'plaidLink.linkedBy', userMap);
      break;
    case 'tasks':
      remapPath(doc, 'jobId', jobMap);
      remapPath(doc, 'customerId', customerMap);
      remapPath(doc, 'projectTaskId', taskMap);
      remapPath(doc, 'assignedTo', userMap);
      remapPath(doc, 'completedBy', userMap);
      remapPath(doc, 'createdBy', userMap);
      if (Array.isArray(doc.notes)) {
        doc.notes = doc.notes.map((n) => ({ ...n, createdBy: remapSingleId(n.createdBy, userMap) }));
      }
      if (Array.isArray(doc.updates)) {
        doc.updates = doc.updates.map((u) => ({ ...u, createdBy: remapSingleId(u.createdBy, userMap) }));
      }
      break;
    case 'appointments':
      remapPath(doc, 'jobId', jobMap);
      remapPath(doc, 'customerId', customerMap);
      remapPath(doc, 'createdBy', userMap);
      break;
    case 'documentfolders':
      remapPath(doc, 'parentId', folderMap);
      remapPath(doc, 'createdBy', userMap);
      break;
    case 'files':
      remapPath(doc, 'jobId', jobMap);
      remapPath(doc, 'taskId', taskMap);
      remapPath(doc, 'customerId', customerMap);
      remapPath(doc, 'folderId', folderMap);
      remapPath(doc, 'uploadedBy', userMap);
      break;
    case 'bills':
      break;
    case 'activities':
      remapPath(doc, 'jobId', jobMap);
      remapPath(doc, 'taskId', taskMap);
      remapPath(doc, 'customerId', customerMap);
      remapPath(doc, 'fileId', fileMap);
      remapPath(doc, 'createdBy', userMap);
      break;
    case 'estimates':
      remapPath(doc, 'customerId', customerMap);
      remapPath(doc, 'jobId', jobMap);
      remapPath(doc, 'createdBy', userMap);
      remapPath(doc, 'updatedBy', userMap);
      if (doc.derivedDocuments) {
        if (Array.isArray(doc.derivedDocuments.invoiceIds)) {
          doc.derivedDocuments.invoiceIds = doc.derivedDocuments.invoiceIds.map((id) => remapSingleId(id, invoiceMap));
        }
        if (Array.isArray(doc.derivedDocuments.contractIds)) {
          doc.derivedDocuments.contractIds = doc.derivedDocuments.contractIds.map((id) => remapSingleId(id, contractMap));
        }
      }
      break;
    case 'invoices':
      remapPath(doc, 'customerId', customerMap);
      remapPath(doc, 'jobId', jobMap);
      remapPath(doc, 'estimateId', estimateMap);
      remapPath(doc, 'createdBy', userMap);
      remapPath(doc, 'updatedBy', userMap);
      break;
    case 'contracts':
      remapPath(doc, 'customerId', customerMap);
      remapPath(doc, 'jobId', jobMap);
      remapPath(doc, 'estimateId', estimateMap);
      remapPath(doc, 'createdBy', userMap);
      remapPath(doc, 'updatedBy', userMap);
      break;
    case 'documentsequences':
    case 'plaidregistercaches':
      break;
    default:
      break;
  }
}

function buildUniqueDemoEmail(baseEmail, targetSlug, attempt = 0) {
  const normalized = String(baseEmail || '').trim().toLowerCase();
  const [localRaw, domainRaw] = normalized.includes('@') ? normalized.split('@') : [normalized, 'example.com'];
  const local = (localRaw || 'demo').replace(/[^a-z0-9._+-]/g, '') || 'demo';
  const domain = (domainRaw || 'example.com').replace(/[^a-z0-9.-]/g, '') || 'example.com';
  const slugPart = String(targetSlug || 'tenant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'tenant';
  if (attempt <= 0) return `${local}+${slugPart}@${domain}`;
  return `${local}+${slugPart}-${attempt}@${domain}`;
}

async function cloneDocumentFoldersWithFallback({ db, docs, folderMap, userMap, targetTenantId }) {
  const pending = new Map(docs.map((doc) => [String(doc._id), doc]));
  let cloned = 0;
  let reused = 0;

  while (pending.size > 0) {
    let progressed = false;

    for (const [sourceId, src] of pending) {
      const sourceParentId = src.parentId ? String(src.parentId) : null;
      if (sourceParentId && pending.has(sourceParentId)) {
        continue;
      }

      const targetParentId = sourceParentId ? folderMap.get(sourceParentId) || null : null;
      const docToInsert = {
        ...src,
        _id: folderMap.get(sourceId),
        tenantId: targetTenantId,
        parentId: targetParentId,
        createdBy: remapSingleId(src.createdBy, userMap),
      };

      try {
        await db.collection('documentfolders').insertOne(docToInsert);
        cloned += 1;
      } catch (error) {
        // Some environments still have a legacy unique index on { parentId, name } (without tenantId).
        // Reuse existing matching folder instead of failing the whole clone.
        if (error?.code !== 11000) {
          throw error;
        }

        const existing = await db.collection('documentfolders').findOne({
          parentId: targetParentId,
          name: docToInsert.name,
        });

        if (!existing?._id) {
          throw error;
        }

        folderMap.set(sourceId, existing._id);
        reused += 1;
      }

      pending.delete(sourceId);
      progressed = true;
    }

    if (!progressed) {
      throw new Error(`Could not resolve folder clone order. Remaining: ${pending.size}`);
    }
  }

  return { cloned, reused };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceSlug = String(args.source || '').trim();
  const sourceTenantIdArg = String(args.sourceTenantId || '').trim();
  const targetSlug = String(args.target || '').trim();
  const targetName = String(args.targetName || targetSlug || '').trim();
  const dryRun = bool(args.dryRun, true);
  const anonymize = bool(args.anonymize, true);
  const demoEmail = String(args.demoEmail || '').trim().toLowerCase();
  const demoPassword = String(args.demoPassword || '').trim();

  if ((!sourceSlug && !sourceTenantIdArg) || !targetSlug || !targetName) {
    console.error(
      'Usage: node src/scripts/cloneTenant.js (--source <source-slug>|--sourceTenantId <tenant-id>) --target <target-slug> --targetName "<Tenant Name>" [--dryRun true|false] [--anonymize true|false] [--demoEmail email --demoPassword password]\nAnonymize defaults to true. Pass --anonymize false only for a private copy of your own tenant.'
    );
    process.exit(1);
  }

  if (!anonymize) {
    console.warn('WARNING: --anonymize false copies names, contact details, notes, and password hashes.');
  }

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required in environment.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  try {
    const sourceTenantIdFromArg = toObjectId(sourceTenantIdArg);
    if (sourceTenantIdArg && !sourceTenantIdFromArg) {
      throw new Error(`Invalid sourceTenantId: ${sourceTenantIdArg}`);
    }

    let sourceTenant = null;
    let sourceTenantId = null;

    if (sourceTenantIdFromArg) {
      sourceTenantId = sourceTenantIdFromArg;
      sourceTenant = await Tenant.findById(sourceTenantIdFromArg).setOptions({ bypassTenant: true }).lean();
      if (!sourceTenant) {
        console.warn(`Source tenant document not found for id ${sourceTenantIdArg}; cloning by tenantId only.`);
      }
    } else {
      sourceTenant = await Tenant.findOne({
        $or: [
          { slug: sourceSlug.toLowerCase() },
          { name: sourceSlug },
          { name: { $regex: `^${sourceSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
        ],
      }).setOptions({ bypassTenant: true });
      if (!sourceTenant) {
        const available = await Tenant.find({}, { name: 1, slug: 1, isActive: 1 })
          .setOptions({ bypassTenant: true })
          .lean();
        const options = available
          .map((t) => `- ${t.slug} (${t.name})${t.isActive ? '' : ' [inactive]'}`)
          .join('\n');
        throw new Error(`Source tenant not found: ${sourceSlug}\nAvailable tenants:\n${options || '(none found)'}`);
      }
      sourceTenantId = sourceTenant._id;
    }

    const existingTarget = await Tenant.findOne({ slug: targetSlug }).setOptions({ bypassTenant: true });
    if (existingTarget) {
      throw new Error(`Target tenant slug already exists: ${targetSlug}`);
    }

    const targetTenantId = new mongoose.Types.ObjectId();
    const targetTenant = {
      _id: targetTenantId,
      name: targetName,
      slug: targetSlug.toLowerCase(),
      isActive: true,
      logo: sourceTenant?.logo || undefined,
      logoLight: sourceTenant?.logoLight || undefined,
      logoDark: sourceTenant?.logoDark || undefined,
      pipelineStageOverrides: sourceTenant?.pipelineStageOverrides || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = mongoose.connection.db;
    const sourceDocs = {};
    const idMaps = {};

    for (const col of COLLECTIONS) {
      const docs = await db.collection(col).find({ tenantId: sourceTenantId }).toArray();
      sourceDocs[col] = docs;
      const map = new Map();
      docs.forEach((d) => map.set(String(d._id), new mongoose.Types.ObjectId()));
      idMaps[col] = map;
      console.log(`${col}: ${docs.length}`);
    }

    if (dryRun) {
      console.log('\n[DRY RUN] No data written.');
      console.log(`Would create tenant: ${targetTenant.slug} (${targetTenant._id})`);
      return;
    }

    await db.collection('tenants').insertOne(targetTenant);
    console.log(`Created target tenant ${targetSlug}`);

    for (const col of COLLECTIONS) {
      const docs = sourceDocs[col];
      if (!docs.length) continue;

      if (anonymize && col === 'plaidregistercaches') {
        console.log('Skipped plaidregistercaches (bank cache is not copied into an anonymized demo)');
        continue;
      }

      if (col === 'documentfolders') {
        const { cloned, reused } = await cloneDocumentFoldersWithFallback({
          db,
          docs,
          folderMap: idMaps.documentfolders,
          userMap: idMaps.users,
          targetTenantId,
        });
        console.log(`Cloned ${cloned} -> ${col}${reused ? ` (reused ${reused} existing)` : ''}`);
        continue;
      }

      const out = docs.map((src, idx) => {
        const cloned = { ...src };
        cloned._id = idMaps[col].get(String(src._id));
        cloned.tenantId = targetTenantId;
        remapReferences(col, cloned, idMaps);
        if (anonymize) anonymizeByCollection(col, cloned, idx, { targetSlug });
        return cloned;
      });
      await db.collection(col).insertMany(out, { ordered: false });
      console.log(`Cloned ${out.length} -> ${col}`);
    }

    if (demoEmail && demoPassword) {
      const users = db.collection('users');
      const existingDemoInTarget = await users.findOne({ tenantId: targetTenantId, email: demoEmail });
      if (existingDemoInTarget) {
        console.log(`Demo login already exists in target tenant: ${demoEmail}`);
      } else {
        const hash = await bcrypt.hash(demoPassword, 10);
        const now = new Date();
        const baseDoc = {
          _id: new mongoose.Types.ObjectId(),
          tenantId: targetTenantId,
          name: 'Demo Admin',
          password: hash,
          role: 'admin',
          isActive: true,
          isPending: false,
          createdAt: now,
          updatedAt: now,
        };
        let createdEmail = demoEmail;
        let inserted = false;
        for (let attempt = 0; attempt < 15; attempt += 1) {
          const candidateEmail = attempt === 0 ? demoEmail : buildUniqueDemoEmail(demoEmail, targetSlug, attempt - 1);
          try {
            await users.insertOne({
              ...baseDoc,
              _id: new mongoose.Types.ObjectId(),
              email: candidateEmail,
            });
            createdEmail = candidateEmail;
            inserted = true;
            break;
          } catch (error) {
            if (error?.code !== 11000) throw error;
          }
        }
        if (!inserted) {
          throw new Error(`Could not create demo login due to duplicate email conflicts for base: ${demoEmail}`);
        }
        if (createdEmail === demoEmail) {
          console.log(`Created demo login: ${createdEmail} (role: admin)`);
        } else {
          console.log(`Created demo login with fallback email: ${createdEmail} (requested: ${demoEmail}, role: admin)`);
        }
      }
    }

    console.log('\nClone complete.');
    console.log(`Source tenant: ${sourceSlug || sourceTenantIdArg}`);
    console.log(`Target tenant: ${targetSlug}`);
    console.log(`Anonymized: ${anonymize ? 'yes' : 'no'}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('cloneTenant failed:', err?.message || err);
    process.exit(1);
  });
}

module.exports = { anonymizeByCollection };

