/* eslint-disable no-console */
/**
 * One-time read of worksheet files already uploaded on jobs.
 * Saves the worksheet note, and a gate code when the customer does not have one.
 * Leaves the job title, price, address, and customer name as they are.
 *
 *   npm run scrape-saved-worksheets -- --dry-run
 *   npm run scrape-saved-worksheets -- --job "Luci Vees"
 *   npm run scrape-saved-worksheets -- --limit 10
 *
 * Jobs that already have a worksheet note are skipped, so it is safe to run again.
 */
require('dotenv').config();
process.env.OPENAI_WORKSHEET_CHECK_MODEL = 'off';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');
const { s3Client, BUCKET_NAME, isS3Configured } = require('../config/s3');
const File = require('../models/File');
const Job = require('../models/Job');
const Customer = require('../models/Customer');
const { readWorksheetImages } = require('../controllers/worksheetController');
const { worksheetJobNote } = require('../utils/worksheetNote');
const { worksheetFingerprintText } = require('../utils/jobSimilarity');
const { refreshJobFingerprint } = require('../services/jobFingerprint');

const PAGE_EDGE = 2000;
const ZOOM_EDGE = 1600;
const RENDER_EDGE = 2600;
const ZOOMS = [
  { x: 0.45, y: 0, w: 0.55, h: 0.3 },
  { x: 0, y: 0.08, w: 0.5, h: 0.84 },
];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retry = error.status === 429 || error.status === 500 || error.status === 503 || error.code === 'TIMEOUT';
      if (!retry || attempt === 3) throw error;
      console.error(`  retry ${attempt}: ${error.message}`);
      await sleep(5000 * attempt);
    }
  }
  throw lastError;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

function loadCanvas() {
  try {
    return require('@napi-rs/canvas');
  } catch {
    return require(path.resolve(__dirname, '../../../frontend/node_modules/@napi-rs/canvas'));
  }
}

async function bodyToBuffer(body) {
  if (!body) throw new Error('Empty file');
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function localCandidates(file) {
  const uploads = path.resolve(__dirname, '../../uploads');
  const paths = [];
  if (file.path && path.isAbsolute(file.path)) paths.push(file.path);
  if (file.path) paths.push(path.resolve(__dirname, '../../', file.path));
  if (file.filename) {
    paths.push(path.join(uploads, file.filename));
    paths.push(path.resolve(process.cwd(), 'uploads', file.filename));
  }
  return paths;
}

async function readStoredFile(file) {
  const keys = [file.s3Key, file.path, file.filename && `uploads/${file.filename}`].filter(Boolean);
  if (isS3Configured() && s3Client && keys.length) {
    let lastError = null;
    for (const Key of keys) {
      try {
        const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key }));
        return bodyToBuffer(response.Body);
      } catch (error) {
        lastError = error;
      }
    }
    for (const candidate of localCandidates(file)) {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
    }
    throw lastError || new Error('File is missing from storage');
  }
  for (const candidate of localCandidates(file)) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
  }
  throw new Error('File is missing from storage');
}

function headerTurn(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const band = Math.max(8, Math.round(Math.min(width, height) * 0.12));
  const score = (x, y, w, h) => {
    const data = ctx.getImageData(Math.floor(x), Math.floor(y), Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))).data;
    let blue = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      count += 1;
      if (b > 140 && b > r + 30 && g > 80) blue += 1;
    }
    return count ? blue / count : 0;
  };
  const edges = {
    top: score(0, 0, width, band),
    bottom: score(0, height - band, width, band),
    left: score(0, 0, band, height),
    right: score(width - band, 0, band, height),
  };
  const [edge, value] = Object.entries(edges).sort((a, b) => b[1] - a[1])[0];
  if (value < 0.08) return 0;
  if (edge === 'right') return -90;
  if (edge === 'left') return 90;
  if (edge === 'bottom') return 180;
  return 0;
}

function rotateCanvas(createCanvas, source, degrees) {
  const turn = ((degrees % 360) + 360) % 360;
  if (!turn) return source;
  const swap = turn % 180 !== 0;
  const canvas = createCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function fitCanvas(createCanvas, image, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = createCanvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropJpeg(createCanvas, source, x, y, w, h, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = createCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/jpeg', 85);
}

function pageImages(createCanvas, canvas) {
  const images = [
    {
      buffer: cropJpeg(createCanvas, canvas, 0, 0, canvas.width, canvas.height, PAGE_EDGE),
      mime: 'image/jpeg',
    },
  ];
  for (const zoom of ZOOMS) {
    const sx = Math.round(canvas.width * zoom.x);
    const sy = Math.round(canvas.height * zoom.y);
    const sw = Math.max(1, Math.round(canvas.width * zoom.w));
    const sh = Math.max(1, Math.round(canvas.height * zoom.h));
    images.push({ buffer: cropJpeg(createCanvas, canvas, sx, sy, sw, sh, ZOOM_EDGE), mime: 'image/jpeg' });
  }
  return images;
}

async function renderFirstPage(buffer, mimetype, filename) {
  const { createCanvas, loadImage } = loadCanvas();
  const isPdf = /pdf/i.test(mimetype || '') || /\.pdf$/i.test(filename || '');
  let imageBuffer = buffer;
  if (isPdf) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worksheet-'));
    const pdfPath = path.join(dir, 'page.pdf');
    const outBase = path.join(dir, 'page');
    fs.writeFileSync(pdfPath, buffer);
    try {
      await runCommand('pdftoppm', ['-f', '1', '-l', '1', '-jpeg', '-scale-to', String(RENDER_EDGE), '-singlefile', pdfPath, outBase]);
      imageBuffer = fs.readFileSync(`${outBase}.jpg`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const fitted = fitCanvas(createCanvas, await loadImage(imageBuffer), RENDER_EDGE);
  return { createCanvas, canvas: rotateCanvas(createCanvas, fitted, headerTurn(fitted)) };
}

function isWorksheetFile(file) {
  return /worksheet/i.test(`${file.originalName || ''} ${file.filename || ''}`);
}

async function chosenFiles(titleQuery) {
  const files = await File.find({ jobId: { $ne: null } })
    .select('originalName filename mimetype jobId createdAt')
    .lean();
  const newest = new Map();
  for (const file of files) {
    if (!file.jobId || !isWorksheetFile(file)) continue;
    const key = String(file.jobId);
    const current = newest.get(key);
    if (!current || new Date(file.createdAt || 0) > new Date(current.createdAt || 0)) newest.set(key, file);
  }
  const jobs = await Job.find({ _id: { $in: [...newest.keys()] } }).select('title notes customerId createdBy tenantId');
  const query = titleQuery.trim().toLowerCase();
  return jobs
    .filter((job) => !query || String(job.title || '').toLowerCase().includes(query))
    .map((job) => ({ job, file: newest.get(String(job._id)) }))
    .filter((row) => row.file);
}

async function saveWorksheet(job, reading) {
  const note = worksheetJobNote(reading?.review, reading?.draft?.gateCode);
  if (!note) return 'empty';
  job.notes = job.notes || [];
  job.notes.push({
    content: note,
    createdBy: job.createdBy,
    createdByName: 'Worksheet file',
    createdAt: new Date(),
    isWorksheet: true,
  });
  job.markModified('notes');
  await job.save();

  const gateCode = String(reading?.draft?.gateCode || '').trim();
  if (gateCode && job.customerId) {
    const customer = await Customer.findById(job.customerId).select('gateCode');
    if (customer && !String(customer.gateCode || '').trim()) {
      customer.gateCode = gateCode.slice(0, 80);
      await customer.save();
    }
  }

  try {
    await refreshJobFingerprint(job);
  } catch (error) {
    console.error(`  fingerprint skipped: ${error.message}`);
  }
  return note;
}

async function readFileNote(file, filename) {
  const buffer = await readStoredFile(file);
  let { createCanvas, canvas } = await renderFirstPage(buffer, file.mimetype, filename);
  let reading = await readWorksheetImages({ images: pageImages(createCanvas, canvas), filename });
  if (reading?.pageTurn) {
    canvas = rotateCanvas(createCanvas, canvas, reading.pageTurn);
    reading = await readWorksheetImages({ images: pageImages(createCanvas, canvas), filename });
  }
  return reading;
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is missing');
    process.exit(1);
  }
  const dryRun = hasFlag('--dry-run');
  const limit = Number(argValue('--limit')) || 0;
  const titleQuery = argValue('--job');

  await mongoose.connect(process.env.MONGODB_URI);
  let rows = await chosenFiles(titleQuery);
  rows.sort((a, b) => String(a.job.title || '').localeCompare(String(b.job.title || '')));
  if (limit > 0) rows = rows.slice(0, limit);

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const { job, file } of rows) {
    const title = job.title || 'Untitled job';
    const filename = file.originalName || file.filename || 'worksheet.pdf';
    if (worksheetFingerprintText(job.notes)) {
      skipped += 1;
      console.log(`skip  ${title} (worksheet note already saved)`);
      continue;
    }
    if (dryRun) {
      console.log(`would read  ${title}  ←  ${filename}`);
      continue;
    }
    try {
      const reading = await withRetry(() => readFileNote(file, filename));
      const note = await saveWorksheet(job, reading);
      if (note === 'empty') {
        skipped += 1;
        console.log(`skip  ${title} (reader found no worksheet lines)`);
      } else {
        saved += 1;
        const first = note.split('\n')[0];
        console.log(`saved ${title}  ${first}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`fail  ${title}: ${error.message}`);
    }
    await sleep(300);
  }

  console.log(
    dryRun
      ? `Would read ${rows.length} worksheet file${rows.length === 1 ? '' : 's'}.`
      : `Worksheet notes: ${saved} saved, ${skipped} skipped, ${failed} failed.`,
  );
  await mongoose.disconnect();
  if (failed) process.exitCode = 1;
}

run().catch(async (error) => {
  console.error(error.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
