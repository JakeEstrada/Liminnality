const crypto = require('crypto');

function stripEnv(value) {
  let s = String(value || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function twilioAuthToken() {
  return stripEnv(process.env.TWILIO_AUTH_TOKEN);
}

function normalizeParams(params) {
  const out = {};
  if (!params || typeof params !== 'object') return out;
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value == null || typeof value === 'object') return;
    out[key] = String(value);
  });
  return out;
}

function signTwilioRequest(authToken, url, params) {
  const body = normalizeParams(params);
  const data = Object.keys(body)
    .sort()
    .reduce((acc, key) => acc + key + body[key], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

function signaturesMatch(expected, received) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function webhookUrlCandidates(req) {
  const pathAndQuery = req.originalUrl || req.url || '';
  const urls = [];
  const envBase = stripEnv(process.env.PUBLIC_API_BASE_URL).replace(/\/$/, '');
  if (envBase) urls.push(`${envBase}${pathAndQuery}`);
  const forwardedProto = req.get?.('x-forwarded-proto');
  const proto = (forwardedProto ? String(forwardedProto).split(',')[0].trim() : '') || req.protocol;
  const forwardedHost = req.get?.('x-forwarded-host');
  const host = (forwardedHost ? String(forwardedHost).split(',')[0].trim() : '') || req.get?.('host');
  if (proto && host) urls.push(`${proto}://${host}${pathAndQuery}`);
  return [...new Set(urls)];
}

function isValidTwilioSignature({ authToken, signature, urls, params }) {
  if (!authToken || !signature || !urls?.length) return false;
  return urls.some((url) => signaturesMatch(signTwilioRequest(authToken, url, params), signature));
}

function requireTwilioSignature(req, res, next) {
  const authToken = twilioAuthToken();
  const signature = req.get('x-twilio-signature') || '';
  const urls = webhookUrlCandidates(req);
  if (!isValidTwilioSignature({ authToken, signature, urls, params: req.body })) {
    console.error('Twilio webhook rejected');
    return res.status(403).type('text/plain').send('Forbidden');
  }
  return next();
}

module.exports = {
  isValidTwilioSignature,
  normalizeParams,
  requireTwilioSignature,
  signTwilioRequest,
  twilioAuthToken,
  webhookUrlCandidates,
};
