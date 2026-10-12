const File = require('../models/File');
const Job = require('../models/Job');
const Activity = require('../models/Activity');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME, isS3Configured } = require('../config/s3');
const { getTenantContext } = require('../middleware/tenantContext');
const { resolveJobId } = require('../utils/resolveJobId');
// Get uploads directory - same as in upload.js middleware
// Use environment variable if set, otherwise use relative path
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
function normalizeS3Key(value) {
  if (!value) return '';
  let s = String(value).trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      s = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
      if (BUCKET_NAME && (s === BUCKET_NAME || s.startsWith(`${BUCKET_NAME}/`))) {
        s = s.slice(BUCKET_NAME.length).replace(/^\/+/, '');
      }
    }
  } catch (_) {
    /* keep original */
  }
  return s.replace(/^\/+/, '');
}

function candidateS3Keys(file) {
  const keys = [];
  const add = (raw) => {
    const n = normalizeS3Key(raw);
    if (n && !keys.includes(n)) keys.push(n);
  };
  add(file.s3Key);
  add(file.path);
  if (file.filename) {
    add(`uploads/${file.filename}`);
    add(`tenant-logos/${file.filename}`);
    add(`website/${file.filename}`);
    add(file.filename);
  }
  return keys;
}

function isS3File(file) {
  if (file.s3Key) return true;
  const storedPath = file.path && String(file.path);
  if (!storedPath) return false;
  if (/^https?:\/\//i.test(storedPath)) return true;
  if (path.isAbsolute(storedPath)) return false;
  return storedPath.startsWith('uploads/') || storedPath.startsWith('tenant-logos/') || storedPath.startsWith('website/');
}

async function s3BodyToNodeStream(body) {
  if (!body) {
    throw new Error('Empty S3 body');
  }
  if (typeof body.pipe === 'function') {
    return body;
  }
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    return Readable.from(Buffer.from(bytes));
  }
  if (typeof Readable.fromWeb === 'function' && typeof body.getReader === 'function') {
    return Readable.fromWeb(body);
  }
  throw new Error('Unsupported S3 body type');
}

function storageErrorStatus(error) {
  const code = error?.name || error?.Code || error?.code || '';
  if (code === 'NoSuchKey' || code === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
    return 404;
  }
  if (code === 'AccessDenied' || code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') {
    return 403;
  }
  return 500;
}

function storageErrorMessage(error) {
  const code = error?.name || error?.Code || error?.code || '';
  if (code === 'NoSuchKey' || code === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
    return 'The file record exists, but the object is missing from S3 (wrong key or it was never uploaded to this bucket).';
  }
  if (code === 'InvalidAccessKeyId') {
    return 'AWS access key is invalid or was deleted. Create a new IAM access key and update AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY on the API host.';
  }
  if (code === 'SignatureDoesNotMatch') {
    return 'AWS secret key does not match the access key. Update AWS_SECRET_ACCESS_KEY (no extra spaces or quotes).';
  }
  if (code === 'AccessDenied') {
    return 'S3 denied this IAM user. Grant s3:GetObject, s3:PutObject, s3:DeleteObject, and s3:ListBucket on this bucket, and confirm AWS_REGION matches the bucket region.';
  }
  if (error?.message === 'File not found on server') {
    return 'The file is not on the server disk and S3 is not configured or the object was not found.';
  }
  return error?.message || 'Failed to retrieve file';
}

async function getFileStream(file) {
  const keys = candidateS3Keys(file);
  if (isS3Configured() && (isS3File(file) || keys.length)) {
    let lastError = null;
    for (const Key of keys) {
      try {
        console.log('Fetching file from S3:', Key);
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key,
          })
        );
        return await s3BodyToNodeStream(response.Body);
      } catch (error) {
        lastError = error;
        console.error('Error fetching file from S3:', Key, error?.name || error?.message || error);
      }
    }

    const localPath = findLocalFilePath(file);
    if (localPath) {
      console.log('S3 miss; reading file from local filesystem:', localPath);
      return fs.createReadStream(localPath);
    }

    if (lastError) throw lastError;
  }

  const filePath = findLocalFilePath(file);
  if (!filePath) {
    throw new Error('File not found on server');
  }

  console.log('Reading file from local filesystem:', filePath);
  return fs.createReadStream(filePath);
}

async function findFileDocument(id) {
  let file = await File.findOne({ _id: id });
  if (file) return file;

  file = await File.findOne({ _id: id }).setOptions({ bypassTenant: true });
  if (!file) return null;

  const { tenantId } = getTenantContext();
  if (file.tenantId && tenantId && String(file.tenantId) !== String(tenantId)) {
    return null;
  }
  return file;
}

function pipeFileStream(fileStream, res) {
  fileStream.on('error', (err) => {
    console.error('File stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: storageErrorMessage(err) });
    } else {
      res.destroy();
    }
  });
  fileStream.pipe(res);
}

// Helper function to find file path on local filesystem (fallback)
function findLocalFilePath(file) {
  const pathsToTry = [];
  
  // 1. Try the stored path (should be absolute from multer)
  if (file.path) {
    if (path.isAbsolute(file.path)) {
      pathsToTry.push(file.path);
    } else {
      // If relative, resolve it
      pathsToTry.push(path.resolve(__dirname, '../../', file.path));
    }
  }
  
  // 2. Tenant logos stored as tenant-logos/<tenantId>/logo-*.ext
  if (file.path && String(file.path).startsWith('tenant-logos/')) {
    pathsToTry.push(path.join(UPLOADS_DIR, file.path));
    pathsToTry.push(path.resolve(process.cwd(), 'uploads', file.path));
  }

  // 3. Try in uploads directory with filename (most reliable)
  pathsToTry.push(path.join(UPLOADS_DIR, file.filename));
  
  // 4. Try resolving from current working directory
  pathsToTry.push(path.resolve(process.cwd(), 'uploads', file.filename));
  
  // 5. Try relative to backend directory
  pathsToTry.push(path.resolve(__dirname, '../../uploads', file.filename));
  
  // Try each path
  for (const filePath of pathsToTry) {
    if (fs.existsSync(filePath)) {
      console.log('Found file at:', filePath);
      return filePath;
    }
  }
  
  // Log all attempted paths for debugging
  console.error('File not found. Searched paths:', {
    storedPath: file.path,
    filename: file.filename,
    attemptedPaths: pathsToTry,
    uploadsDir: UPLOADS_DIR,
    __dirname: __dirname,
    cwd: process.cwd()
  });
  
  return null;
}

async function deleteStoredFileBinary(file) {
  if (!file) return;
  if (isS3Configured() && isS3File(file)) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const s3Key = file.s3Key || file.path;
    try {
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      });
      await s3Client.send(command);
      console.log('File deleted from S3:', s3Key);
    } catch (error) {
      console.error('Error deleting file from S3:', error);
    }
    return;
  }

  const filePath = findLocalFilePath(file);
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('File deleted from local filesystem:', filePath);
  }
}

async function resolveCreatedBy(req, fallbackUserId = null) {
  const User = require('../models/User');
  let createdBy = req.user?._id || req.body?.createdBy || fallbackUserId || null;
  if (!createdBy) {
    const defaultUser = await User.findOne({ isActive: true });
    if (defaultUser) createdBy = defaultUser._id;
  }
  return createdBy;
}

async function getDescendantFolderIds(rootFolderId) {
  const allFolders = await DocumentFolder.find({}, '_id parentId').lean();
  const childrenByParent = new Map();
  allFolders.forEach((f) => {
    const key = f.parentId ? String(f.parentId) : 'root';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(String(f._id));
  });

  const queue = [String(rootFolderId)];
  const descendants = [];
  while (queue.length > 0) {
    const current = queue.shift();
    descendants.push(current);
    const kids = childrenByParent.get(current) || [];
    kids.forEach((k) => queue.push(k));
  }
  return descendants;
}

// Upload file
async function uploadFile(req, res) {
  try {
    const User = require('../models/User');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { jobId, taskId, fileType = 'other' } = req.body;

    // Support both jobId and taskId (for projects)
    if (!jobId && !taskId) {
      // Delete uploaded file if neither jobId nor taskId is provided
      if (req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      } else if (isS3Configured() && req.file.key) {
        // Delete from S3 if uploaded there
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: req.file.key,
          }));
        } catch (s3Error) {
          console.error('Error deleting file from S3:', s3Error);
        }
      }
      return res.status(400).json({ error: 'Job ID or Task ID is required' });
    }

    let job = null;
    let task = null;
    let customerId = null;
    let createdBy = null;

    if (taskId) {
      // Handle project file upload
      const Task = require('../models/Task');
      task = await Task.findById(taskId);
      if (!task) {
        // Delete uploaded file if task not found
        if (req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        } else if (isS3Configured() && req.file.key) {
          const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: req.file.key,
            }));
          } catch (s3Error) {
            console.error('Error deleting file from S3:', s3Error);
          }
        }
        return res.status(404).json({ error: 'Task/Project not found' });
      }
      customerId = task.customerId;
      createdBy = req.user?._id || task.createdBy;
    } else if (jobId) {
      // Handle job file upload (existing logic)
      job = await Job.findById(jobId);
      if (!job) {
        // Delete uploaded file if job not found
        if (req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        } else if (isS3Configured() && req.file.key) {
          const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: req.file.key,
            }));
          } catch (s3Error) {
            console.error('Error deleting file from S3:', s3Error);
          }
        }
        return res.status(404).json({ error: 'Job not found' });
      }
      customerId = job.customerId;
      createdBy = req.user?._id || job.createdBy;
    }
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      } else {
        // Delete uploaded file if no user available
        if (req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        } else if (isS3Configured() && req.file.key) {
          const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: req.file.key,
            }));
          } catch (s3Error) {
            console.error('Error deleting file from S3:', s3Error);
          }
        }
        return res.status(400).json({ error: 'No user available' });
      }
    }

    // Determine file location based on storage type
    let filePath;
    let s3Key;
    
    if (isS3Configured() && (req.file.location || req.file.key)) {
      // File was uploaded to S3 (multer-s3 provides location and key)
      s3Key = req.file.key || (req.file.location ? req.file.location.split('/').slice(-2).join('/') : null);
      filePath = s3Key; // Store S3 key as path for backward compatibility
      console.log('Upload - File uploaded to S3:', s3Key);
      console.log('Upload - req.file.location:', req.file.location);
      console.log('Upload - req.file.key:', req.file.key);
    } else {
      // File was uploaded to local filesystem
      let absolutePath = req.file.path;
      console.log('Upload - req.file.path:', req.file.path);
      console.log('Upload - isAbsolute:', path.isAbsolute(absolutePath));
      console.log('Upload - UPLOADS_DIR:', UPLOADS_DIR);
      console.log('Upload - filename:', req.file.filename);
      
      if (!path.isAbsolute(absolutePath)) {
        absolutePath = path.resolve(UPLOADS_DIR, req.file.filename);
        console.log('Upload - resolved to:', absolutePath);
      }
      
      // Verify the file exists at this path
      if (!fs.existsSync(absolutePath)) {
        console.error('Upload - File does not exist at resolved path:', absolutePath);
        // Try the original path
        if (fs.existsSync(req.file.path)) {
          absolutePath = path.resolve(req.file.path);
          console.log('Upload - Using original path resolved:', absolutePath);
        }
      }
      
      filePath = absolutePath;
      console.log('Upload - File stored locally:', filePath);
    }

    // Get filename - multer-s3 uses 'key' instead of 'filename'
    const filename = req.file.filename || (req.file.key ? req.file.key.split('/').pop() : 'unknown');
    
    const file = new File({
      jobId: job?._id || undefined,
      taskId: task?._id || undefined,
      customerId: customerId || undefined,
      filename: filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype || req.file.contentType,
      size: req.file.size,
      path: filePath,
      s3Key: s3Key, // Store S3 key separately
      fileType: fileType,
      uploadedBy: createdBy
    });

    await file.save();

    // Log activity (only if customerId exists, as it's required by Activity model)
    if (createdBy && customerId) {
      try {
        await Activity.create({
          type: 'file_uploaded',
          jobId: job?._id || undefined,
          customerId: customerId,
          fileName: req.file.originalname,
          fileId: file._id,
          createdBy: createdBy
        });
      } catch (activityError) {
        // Log but don't fail if activity creation fails (e.g., missing customerId for tasks)
        console.error('Failed to create activity log:', activityError.message);
      }
    }

    await file.populate('uploadedBy', 'name email');

    res.status(201).json(file);
  } catch (error) {
    // Clean up uploaded file on error (only for local files)
    if (req.file && req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
}

/**
 * Temporary upload for Twilio MMS: no job/task required; file is referenced by `_id`
 * when calling `/twilio/send-sms` or `/twilio/send-sms-adhoc` with `mediaFileId`.
 */
async function uploadTwilioMmsStaging(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const createdBy = req.user?._id;
    if (!createdBy) {
      if (req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {}
      } else if (isS3Configured() && req.file.key) {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        try {
          await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: req.file.key }));
        } catch (_) {}
      }
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let filePath;
    let s3Key;

    if (isS3Configured() && (req.file.location || req.file.key)) {
      s3Key = req.file.key || (req.file.location ? req.file.location.split('/').slice(-2).join('/') : null);
      filePath = s3Key;
    } else {
      let absolutePath = req.file.path;
      if (!path.isAbsolute(absolutePath)) {
        absolutePath = path.resolve(UPLOADS_DIR, req.file.filename);
      }
      if (!fs.existsSync(absolutePath) && req.file.path && fs.existsSync(req.file.path)) {
        absolutePath = path.resolve(req.file.path);
      }
      filePath = absolutePath;
    }

    const filename = req.file.filename || (req.file.key ? req.file.key.split('/').pop() : 'unknown');

    const file = new File({
      filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype || req.file.contentType,
      size: req.file.size,
      path: filePath,
      s3Key: s3Key || undefined,
      fileType: 'photo',
      uploadedBy: createdBy,
    });

    await file.save();
    return res.status(201).json({ fileId: file._id });
  } catch (error) {
    if (req.file?.path && !req.file?.location && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    } else if (isS3Configured() && req.file?.key) {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: req.file.key }));
      } catch (_) {}
    }
    console.error('uploadTwilioMmsStaging error:', error?.message || error);
    return res.status(500).json({ error: error.message });
  }
}

// Get files for a job
async function getJobFiles(req, res) {
  try {
    const jobId = resolveJobId(req.params.jobId);
    if (!jobId) {
      return res.status(400).json({ error: 'Invalid job id' });
    }

    await File.updateMany({ jobId, isLocked: true }, { $set: { isLocked: false, lockedAt: null } });

    const files = await File.find({ jobId })
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get files for a task/project
async function getTaskFiles(req, res) {
  try {
    const { taskId } = req.params;

    const files = await File.find({ taskId })
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Upload standalone document (not tied to job or task)
async function uploadDocument(req, res) {
  try {
    const User = require('../models/User');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(req.file.mimetype)) {
      // Delete uploaded file
      if (req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      } else if (isS3Configured() && req.file.key) {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: req.file.key,
          }));
        } catch (s3Error) {
          console.error('Error deleting file from S3:', s3Error);
        }
      }
      return res.status(400).json({ error: 'Unsupported file type. Allowed: PDF, TXT, PNG, JPG, WEBP, GIF, DOC, DOCX, XLS, XLSX' });
    }

    const { fileType = 'other' } = req.body;

    // Handle createdBy
    let createdBy = req.user?._id || req.body.createdBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      } else {
        // Delete uploaded file if no user available
        if (req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        } else if (isS3Configured() && req.file.key) {
          const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: req.file.key,
            }));
          } catch (s3Error) {
            console.error('Error deleting file from S3:', s3Error);
          }
        }
        return res.status(400).json({ error: 'No user available' });
      }
    }

    // Determine file location based on storage type
    let filePath;
    let s3Key;
    
    if (isS3Configured() && (req.file.location || req.file.key)) {
      s3Key = req.file.key || (req.file.location ? req.file.location.split('/').slice(-2).join('/') : null);
      filePath = s3Key;
      console.log('Upload Document - File uploaded to S3:', s3Key);
    } else {
      let absolutePath = req.file.path;
      if (!path.isAbsolute(absolutePath)) {
        absolutePath = path.resolve(UPLOADS_DIR, req.file.filename);
      }
      if (!fs.existsSync(absolutePath)) {
        if (fs.existsSync(req.file.path)) {
          absolutePath = path.resolve(req.file.path);
        }
      }
      filePath = absolutePath;
      console.log('Upload Document - File stored locally:', filePath);
    }

    const filename = req.file.filename || (req.file.key ? req.file.key.split('/').pop() : 'unknown');
    
    const file = new File({
      jobId: undefined,
      taskId: undefined,
      customerId: undefined,
      filename: filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype || req.file.contentType,
      size: req.file.size,
      path: filePath,
      s3Key: s3Key,
      fileType: fileType,
      uploadedBy: createdBy,
      description: req.body.description ? String(req.body.description).trim() : undefined,
    });

    await file.save();
    await file.populate('uploadedBy', 'name email');

    res.status(201).json(file);
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && req.file.path && !req.file.location && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
}

// Download file
async function downloadFile(req, res) {
  try {
    const file = await findFileDocument(req.params.id);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
    res.setHeader('Content-Type', file.mimetype);

    const fileStream = await getFileStream(file);
    pipeFileStream(fileStream, res);
  } catch (error) {
    console.error('Error downloading file:', error);
    if (!res.headersSent) {
      res.status(storageErrorStatus(error)).json({ error: storageErrorMessage(error) });
    }
  }
}

// Get file (for viewing images/PDFs)
async function getFile(req, res) {
  try {
    const file = await findFileDocument(req.params.id);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);

    const fileStream = await getFileStream(file);
    pipeFileStream(fileStream, res);
  } catch (error) {
    console.error('Error getting file:', error);
    if (!res.headersSent) {
      res.status(storageErrorStatus(error)).json({ error: storageErrorMessage(error) });
    }
  }
}

// Update file metadata (description only)
async function updateFile(req, res) {
  try {
    const existing = await File.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'File not found' });
    }

    const update = {};
    if (req.body.description !== undefined) {
      update.description = req.body.description ? String(req.body.description).trim() : '';
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'No supported fields to update' });
    }

    const file = await File.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).populate('uploadedBy', 'name email');

    res.json(file);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update file' });
  }
}

// Delete file
async function deleteFile(req, res) {
  try {
    const file = await File.findById(req.params.id);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete physical file from S3 or local filesystem
    await deleteStoredFileBinary(file);

    // Log activity before deleting
    const User = require('../models/User');
    let createdBy = req.user?._id || file.uploadedBy;
    if (!createdBy) {
      const defaultUser = await User.findOne({ isActive: true });
      if (defaultUser) {
        createdBy = defaultUser._id;
      }
    }

    // Log activity only if file is associated with a job or customer
    if (createdBy && (file.jobId || file.customerId)) {
      try {
        await Activity.create({
          type: 'file_deleted',
          jobId: file.jobId || undefined,
          customerId: file.customerId || undefined,
          fileName: file.originalName,
          createdBy: createdBy
        });
      } catch (activityError) {
        // Log but don't fail if activity creation fails (e.g., for standalone documents)
        console.error('Failed to create activity log:', activityError.message);
      }
    }

    await File.findByIdAndDelete(req.params.id);

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  uploadFile,
  uploadTwilioMmsStaging,
  getJobFiles,
  getTaskFiles,
  uploadDocument,
  downloadFile,
  getFile,
  deleteFile,
  updateFile,
  getFileStream,
  deleteStoredFileBinary,
};

