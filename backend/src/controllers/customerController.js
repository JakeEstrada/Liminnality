const Customer = require('../models/Customer');
const Activity = require('../models/Activity');
const Job = require('../models/Job');
const fs = require('fs');
const path = require('path');
const { emitJobCreated, sourceSocketIdFromReq } = require('../services/jobRealtime');
const { publishCustomerChanged } = require('../services/eventBus');
const { applyReferralFields } = require('../utils/referralCompany');

/** Default pipeline job so every API-created customer has at least one job. Skip when caller will create the job (e.g. Add Job modal). */
async function createInitialJobForCustomer(customer, createdBy, req) {
  const baseTitle = (customer.name || 'Customer').trim() || 'New customer';
  const title = `${baseTitle} — Job`.slice(0, 200);
  const job = new Job({
    customerId: customer._id,
    title,
    description: '',
    stage: 'ESTIMATE_IN_PROGRESS',
    source: customer.source || 'other',
    referralCompany: customer.source === 'referral' ? customer.referralCompany || '' : '',
    createdBy,
  });
  await job.save();
  try {
    await Activity.create({
      type: 'job_created',
      jobId: job._id,
      customerId: customer._id,
      note: `Initial job "${job.title}" created for new customer`,
      createdBy,
    });
  } catch (e) {
    console.error('Failed to log initial job activity:', e.message);
  }
  try {
    await emitJobCreated(req, job);
  } catch (e) {
    console.error('Failed to emit initial job created:', e.message);
  }
  return job;
}

// Get all customers
async function getCustomers(req, res) {
  try {
    const { search, tag, page = 1, limit = 50 } = req.query;
    
    let query = {};
    
    // Search by name or email
    if (search) {
      query.$text = { $search: search };
    }
    
    // Filter by tag
    if (tag) {
      query.tags = tag;
    }
    
    const customers = await Customer.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Customer.countDocuments(query);
    
    res.json({
      customers,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get single customer
async function getCustomer(req, res) {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate('createdBy', 'name email');
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Create customer
async function createCustomer(req, res) {
  try {
    const User = require('../models/User');
    
    // Handle createdBy - use req.user if available, otherwise get default user
    let createdBy = req.user?._id || req.body.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      } else {
        return res.status(400).json({ error: 'No user available. Please ensure at least one user exists in the system.' });
      }
    }
    
    const { skipInitialJob, ...customerBody } = req.body;
    applyReferralFields(customerBody);
    const customer = new Customer({
      ...customerBody,
      createdBy: createdBy
    });
    
    await customer.save();
    
    // Log activity
    await Activity.create({
      type: 'customer_created',
      customerId: customer._id,
      note: `Customer "${customer.name}" created`,
      createdBy: createdBy
    });

    // Every customer should have at least one job (pipeline). Skip when the client creates a job in the same flow (e.g. Add Job modal).
    if (!skipInitialJob) {
      try {
        await createInitialJobForCustomer(customer, createdBy, req);
      } catch (jobErr) {
        console.error('Failed to create initial job for customer:', jobErr.message);
        // Customer already exists; surface a clear error so ops can fix
        return res.status(500).json({
          error: 'Customer was created but the initial job could not be created. You can add a job from the pipeline.',
          customerId: customer._id,
        });
      }
    }
    
    publishCustomerChanged(req.app.get('io'), customer.toObject ? customer.toObject() : customer, {
      action: 'created',
      sourceSocketId: sourceSocketIdFromReq(req),
    });
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Update customer
async function updateCustomer(req, res) {
  try {
    const customer = await Customer.findById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    const oldData = customer.toObject();
    applyReferralFields(req.body);
    Object.assign(customer, req.body);
    await customer.save();
    
    // Track changes
    const changes = {};
    ['name', 'primaryPhone', 'primaryEmail', 'gateCode'].forEach(field => {
      if (oldData[field] !== customer[field]) {
        changes[field] = { from: oldData[field], to: customer[field] };
      }
    });
    
    // Log activity if there were changes
    if (Object.keys(changes).length > 0) {
      await Activity.create({
        type: 'customer_updated',
        customerId: customer._id,
        changes: changes,
        note: 'Customer information updated',
        createdBy: req.user._id
      });
    }
    
    publishCustomerChanged(req.app.get('io'), customer.toObject ? customer.toObject() : customer, {
      action: 'updated',
      sourceSocketId: sourceSocketIdFromReq(req),
    });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Delete customer
async function deleteCustomer(req, res) {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    publishCustomerChanged(req.app.get('io'), customer.toObject ? customer.toObject() : customer, {
      action: 'deleted',
      sourceSocketId: sourceSocketIdFromReq(req),
    });
    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get customer's jobs
async function getCustomerJobs(req, res) {
  try {
    const Job = require('../models/Job');
    
    // Return every job for this customer — active, archived, dead estimates, and closed/completed.
    const jobs = await Job.find({ customerId: req.params.id })
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 });
    
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Parse address string into components
function parseAddress(addressStr) {
  if (!addressStr || addressStr.trim() === '') {
    return { street: '', city: '', state: '', zip: '' };
  }
  
  // Remove quotes and trim
  addressStr = addressStr.replace(/^"|"$/g, '').trim();
  
  // Try to parse common formats:
  // "Street, City, State, ZIP"
  // "City, State, ZIP"
  // "Street, City, State ZIP"
  const parts = addressStr.split(',').map(p => p.trim());
  
  let street = '';
  let city = '';
  let state = '';
  let zip = '';
  
  if (parts.length >= 3) {
    // Format: "Street, City, State, ZIP" or "City, State, ZIP"
    street = parts[0];
    city = parts[1] || '';
    
    // Last part might be "State ZIP" or just "State"
    const lastPart = parts[parts.length - 1] || '';
    const stateZipMatch = lastPart.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
    if (stateZipMatch) {
      state = stateZipMatch[1];
      zip = stateZipMatch[2] || '';
    } else {
      state = lastPart;
    }
    
    // If there's a 4th part, it's likely the ZIP
    if (parts.length >= 4) {
      zip = parts[parts.length - 1] || '';
      state = parts[parts.length - 2] || '';
    }
  } else if (parts.length === 2) {
    // Format: "City, State ZIP" or "Street, City"
    street = parts[0];
    const secondPart = parts[1];
    const stateZipMatch = secondPart.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
    if (stateZipMatch) {
      state = stateZipMatch[1];
      zip = stateZipMatch[2] || '';
    } else {
      city = secondPart;
    }
  } else {
    // Single part - could be street or city
    street = addressStr;
  }
  
  return { street, city, state, zip };
}

// Upload CSV and create customers
async function uploadCustomersCSV(req, res) {
  try {
    const User = require('../models/User');
    
    // Get default user for createdBy
    let createdBy = req.user?._id || req.body.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      } else {
        return res.status(400).json({ error: 'No user available. Please ensure at least one user exists in the system.' });
      }
    }
    
    // Check if file path is provided or use default
    const filePath = req.body.filePath || path.join(__dirname, '../../Contact_list_processed.CSV');
    
    if (!fs.existsSync(filePath)) {
      // Return a more informative error that won't crash the frontend
      return res.status(200).json({ 
        message: 'CSV file not found. Please upload the CSV file to the server or provide a file path.',
        imported: 0,
        errors: 0,
        errorDetails: []
      });
    }
    
    // Read and parse CSV
    let fileContent;
    try {
      fileContent = fs.readFileSync(filePath, 'utf-8');
    } catch (readError) {
      console.error('Error reading CSV file:', readError);
      return res.status(500).json({ 
        error: `Failed to read CSV file: ${readError.message}` 
      });
    }
    
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV file is empty or has no data rows' });
    }
    
    // Parse header
    const header = lines[0].split(',').map(h => h.trim());
    const nameIndex = header.findIndex(h => h.toLowerCase() === 'name');
    const phoneIndex = header.findIndex(h => h.toLowerCase() === 'phone');
    const emailIndex = header.findIndex(h => h.toLowerCase() === 'email');
    const addressIndex = header.findIndex(h => h.toLowerCase().includes('address'));
    
    if (nameIndex === -1) {
      return res.status(400).json({ error: 'CSV must have a "Name" column' });
    }
    
    const customers = [];
    const errors = [];
    
    // Parse each row (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      // Parse CSV line (handle quoted fields)
      const row = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      row.push(current.trim()); // Add last field
      
      const name = row[nameIndex] || '';
      const phone = row[phoneIndex] || '';
      const email = row[emailIndex] || '';
      const addressStr = row[addressIndex] || '';
      
      // Skip rows with no name
      if (!name || name.trim() === '' || name.startsWith('#')) {
        continue;
      }
      
      // Parse multiple addresses (separated by semicolons)
      const addressStrings = addressStr.split(';').map(addr => addr.trim()).filter(addr => addr);
      const addresses = [];
      let primaryAddress = null;
      
      for (const addrStr of addressStrings) {
        const parsedAddr = parseAddress(addrStr);
        if (parsedAddr.street || parsedAddr.city) {
          const addressObj = {
            ...parsedAddr,
            fullAddress: addrStr.trim()
          };
          addresses.push(addressObj);
          // First valid address becomes primary
          if (!primaryAddress) {
            primaryAddress = parsedAddr;
          }
        }
      }
      
      // If no addresses parsed, try parsing the whole string
      if (addresses.length === 0 && addressStr.trim()) {
        const parsedAddr = parseAddress(addressStr);
        if (parsedAddr.street || parsedAddr.city) {
          addresses.push({
            ...parsedAddr,
            fullAddress: addressStr.trim()
          });
          primaryAddress = parsedAddr;
        }
      }
      
      // Check if customer already exists (by email or phone)
      let existingCustomer = null;
      if (email) {
        existingCustomer = await Customer.findOne({ primaryEmail: email.toLowerCase() });
      }
      if (!existingCustomer && phone) {
        existingCustomer = await Customer.findOne({ primaryPhone: phone });
      }
      
      // Parse multiple phones (if separated by semicolons)
      const phones = phone ? phone.split(';').map(p => p.trim()).filter(p => p) : [];
      const primaryPhone = phones.length > 0 ? phones[0] : phone;
      
      // Parse multiple emails (if separated by semicolons)
      const emails = email ? email.split(';').map(e => e.trim()).filter(e => e) : [];
      const primaryEmail = emails.length > 0 ? emails[0].toLowerCase() : (email ? email.toLowerCase() : undefined);
      
      if (existingCustomer) {
        // Update existing customer
        existingCustomer.name = name;
        if (primaryPhone) existingCustomer.primaryPhone = primaryPhone;
        if (primaryEmail) existingCustomer.primaryEmail = primaryEmail;
        if (primaryAddress && (primaryAddress.street || primaryAddress.city)) {
          existingCustomer.address = primaryAddress;
        }
        // Add new addresses to existing addresses array
        if (addresses.length > 0) {
          // Merge with existing addresses, avoiding duplicates
          const existingAddresses = existingCustomer.addresses || [];
          const existingFullAddresses = new Set(existingAddresses.map(a => a.fullAddress || `${a.street || ''} ${a.city || ''}`.trim()));
          addresses.forEach(addr => {
            const addrKey = addr.fullAddress || `${addr.street || ''} ${addr.city || ''}`.trim();
            if (!existingFullAddresses.has(addrKey)) {
              existingAddresses.push(addr);
            }
          });
          existingCustomer.addresses = existingAddresses;
        }
        // Add new phones to existing phones array
        if (phones.length > 1) {
          const existingPhones = existingCustomer.phones || [];
          const existingPhonesSet = new Set(existingPhones);
          phones.slice(1).forEach(p => {
            if (!existingPhonesSet.has(p)) {
              existingPhones.push(p);
            }
          });
          existingCustomer.phones = existingPhones;
        }
        // Add new emails to existing emails array
        if (emails.length > 1) {
          const existingEmails = existingCustomer.emails || [];
          const existingEmailsSet = new Set(existingEmails.map(e => e.toLowerCase()));
          emails.slice(1).forEach(e => {
            const emailLower = e.toLowerCase();
            if (!existingEmailsSet.has(emailLower)) {
              existingEmails.push(emailLower);
            }
          });
          existingCustomer.emails = existingEmails;
        }
        await existingCustomer.save();
        customers.push(existingCustomer);
      } else {
        // Create new customer
        try {
          const customer = new Customer({
            name: name.trim(),
            primaryPhone: primaryPhone || undefined,
            primaryEmail: primaryEmail,
            phones: phones.length > 1 ? phones.slice(1) : undefined,
            emails: emails.length > 1 ? emails.slice(1).map(e => e.toLowerCase()) : undefined,
            address: primaryAddress || undefined,
            addresses: addresses.length > 0 ? addresses : undefined,
            source: 'other',
            createdBy: createdBy
          });
          
          await customer.save();
          customers.push(customer);
          
          // Log activity (wrap in try-catch to prevent failures)
          try {
            await Activity.create({
              type: 'customer_created',
              customerId: customer._id,
              note: `Customer "${customer.name}" created from CSV import`,
              createdBy: createdBy
            });
          } catch (activityError) {
            // Log but don't fail the import if activity creation fails
            console.error('Failed to create activity log:', activityError.message);
          }
        } catch (error) {
          errors.push({ row: i + 1, name, error: error.message });
        }
      }
    }
    
    res.json({
      message: `Successfully imported ${customers.length} customers`,
      imported: customers.length,
      errors: errors.length,
      errorDetails: errors
    });
  } catch (error) {
    console.error('Error in uploadCustomersCSV:', error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

function jobSearchDestination(job) {
  if (job?.isDeadEstimate) {
    return {
      type: 'dead_estimate',
      locationLabel: 'Job Archive',
      subtitle: 'Dead estimate',
      path: `/archive?jobId=${job._id}`,
    };
  }
  if (job?.isArchived) {
    return {
      type: 'archived_job',
      locationLabel: 'Job Archive',
      subtitle: 'Archived job',
      path: `/archive?jobId=${job._id}`,
    };
  }
  if (job?.isCompletedClosedOut || job?.stage === 'FINAL_PAYMENT_CLOSED') {
    return {
      type: 'finished_job',
      locationLabel: 'Completed Jobs',
      subtitle: 'Completed job',
      path: `/completed-jobs?jobId=${job._id}`,
    };
  }
  return {
    type: 'pipeline_job',
    locationLabel: 'Pipeline',
    subtitle: job?.stage ? `Stage: ${job.stage}` : 'Pipeline job',
    path: `/pipeline?jobId=${job._id}`,
  };
}

/**
 * Same data as GET /customers/global-search (tenant-scoped). Used by assistant tools.
 * @returns {Promise<Array<{id:string,type:string,title:string,subtitle:string,locationLabel:string,path:string}>>}
 */
async function fetchGlobalCustomerSearchResults({ tenantId, q, limit: limitArg }) {
  const qTrim = String(q || '').trim();
  const limit = Math.min(Math.max(Number(limitArg) || 8, 1), 30);
  if (!qTrim) {
    return [];
  }
  if (!tenantId) {
    throw new Error('Missing tenant context');
  }

  const escaped = qTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRegex = new RegExp(escaped, 'i');

  const nameCustomers = await Customer.find({
    tenantId,
    $or: [{ name: nameRegex }, { primaryEmail: nameRegex }, { primaryPhone: nameRegex }],
  })
    .select('_id')
    .limit(40)
    .lean();
  const customerIds = nameCustomers.map((row) => row._id);

  const [matchedJobs, customersWithNoJobs] = await Promise.all([
    Job.find({
      tenantId,
      $or: [{ title: nameRegex }, ...(customerIds.length ? [{ customerId: { $in: customerIds } }] : [])],
    })
      .populate({ path: 'customerId', select: 'name', strictPopulate: false })
      .select('title stage customerId isArchived isDeadEstimate isCompletedClosedOut')
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean(),
    Customer.aggregate([
      { $match: { tenantId } },
      {
        $lookup: {
          from: 'jobs',
          let: { customerId: '$_id', tenantId: '$tenantId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$tenantId', '$$tenantId'] }, { $eq: ['$customerId', '$$customerId'] }],
                },
              },
            },
            { $project: { _id: 1 } },
          ],
          as: 'jobs',
        },
      },
      {
        $match: {
          $or: [{ name: nameRegex }, { primaryEmail: nameRegex }, { primaryPhone: nameRegex }],
          'jobs.0': { $exists: false },
        },
      },
      { $sort: { updatedAt: -1 } },
      { $limit: limit },
      { $project: { _id: 1, name: 1, primaryEmail: 1, primaryPhone: 1 } },
    ]),
  ]);

  const jobResults = matchedJobs.map((job) => {
    const customerName = job.customerId && typeof job.customerId === 'object' ? job.customerId.name : '';
    const destination = jobSearchDestination(job);
    return {
      id: `job-${job._id}`,
      jobId: String(job._id),
      type: destination.type,
      title: job.title || 'Job',
      subtitle: customerName ? `Customer: ${customerName}` : destination.subtitle,
      locationLabel: destination.locationLabel,
      path: destination.path,
    };
  });

  const results = [
    ...jobResults,
    ...customersWithNoJobs.map((c) => ({
      id: `customer-no-jobs-${c._id}`,
      type: 'customer_no_jobs',
      title: c.name || 'Unnamed customer',
      subtitle: 'Customer exists but has no jobs',
      locationLabel: 'Customers',
      path: `/customers?customerId=${c._id}`,
    })),
  ].slice(0, limit * 4);

  return results;
}

async function globalCustomerSearch(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 30);
    const tenantId = req.user?.tenantId;

    if (!q) {
      return res.json({ results: [] });
    }
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant context' });
    }

    const results = await fetchGlobalCustomerSearchResults({ tenantId, q, limit });
    return res.json({ results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerJobs,
  uploadCustomersCSV,
  globalCustomerSearch,
  fetchGlobalCustomerSearchResults,
};