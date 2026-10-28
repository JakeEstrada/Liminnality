const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME, isS3Configured } = require('../config/s3');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');

function extensionFor(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('gif')) return '.gif';
  if (type.includes('webp')) return '.webp';
  return '.jpg';
}

function bodyToStream(body) {
  if (body && typeof body.pipe === 'function') return body;
  if (body && typeof body.transformToWebStream === 'function') {
    return Readable.fromWeb(body.transformToWebStream());
  }
  throw new Error('Could not read stored photo');
}

async function storeSmsMediaBuffer({ buffer, contentType }) {
  const type = String(contentType || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionFor(type)}`;
  if (isS3Configured()) {
    const key = `sms-media/${filename}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: type,
      }),
    );
    return { filename, path: key, s3Key: key, contentType: type };
  }

  const dir = path.join(UPLOADS_DIR, 'sms-media');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, filename);
  fs.writeFileSync(dest, buffer);
  return { filename, path: dest, s3Key: '', contentType: type };
}

async function openStoredSmsMedia(item) {
  const contentType = item?.contentType || 'image/jpeg';
  if (item?.s3Key && isS3Configured()) {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: item.s3Key }),
    );
    return { stream: bodyToStream(response.Body), contentType };
  }
  const filePath = item?.path && fs.existsSync(item.path) ? item.path : '';
  if (!filePath) throw new Error('Photo file is missing');
  return { stream: fs.createReadStream(filePath), contentType };
}

module.exports = {
  openStoredSmsMedia,
  storeSmsMediaBuffer,
};
