const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const {
  isValidTwilioSignature,
  requireTwilioSignature,
  signTwilioRequest,
} = require('../src/utils/twilioWebhook');

const TOKEN = '12345';
const URL = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675309',
  Digits: '1234',
  From: '+14158675309',
  To: '+18005551212',
};

test('matches the Twilio signature for a form webhook', () => {
  const signature = signTwilioRequest(TOKEN, URL, PARAMS);
  assert.equal(signature, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  assert.equal(
    isValidTwilioSignature({ authToken: TOKEN, signature, urls: [URL], params: PARAMS }),
    true
  );
});

test('rejects a missing, wrong, or mismatched signature', () => {
  const signature = signTwilioRequest(TOKEN, URL, PARAMS);
  assert.equal(isValidTwilioSignature({ authToken: TOKEN, signature: '', urls: [URL], params: PARAMS }), false);
  assert.equal(isValidTwilioSignature({ authToken: TOKEN, signature: 'nope', urls: [URL], params: PARAMS }), false);
  assert.equal(
    isValidTwilioSignature({
      authToken: TOKEN,
      signature,
      urls: ['https://mycompany.com/myapp.php'],
      params: PARAMS,
    }),
    false
  );
  assert.equal(isValidTwilioSignature({ authToken: '', signature, urls: [URL], params: PARAMS }), false);
});

function postForm(port, { path, body, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('webhook middleware accepts a signed request and rejects the rest', async () => {
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  const previousBase = process.env.PUBLIC_API_BASE_URL;
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.PUBLIC_API_BASE_URL = 'https://api.example.com';

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.post('/twilio/sms', requireTwilioSignature, (_req, res) => res.status(200).send('ok'));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const port = server.address().port;
    const path = '/twilio/sms';
    const body = 'From=%2B14158675309&Body=in';
    const params = { From: '+14158675309', Body: 'in' };
    const signature = signTwilioRequest(TOKEN, `https://api.example.com${path}`, params);

    assert.equal(await postForm(port, { path, body, headers: { 'x-twilio-signature': signature } }), 200);
    assert.equal(await postForm(port, { path, body, headers: {} }), 403);
    assert.equal(
      await postForm(port, { path, body, headers: { 'x-twilio-signature': 'bad' } }),
      403
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousToken == null) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = previousToken;
    if (previousBase == null) delete process.env.PUBLIC_API_BASE_URL;
    else process.env.PUBLIC_API_BASE_URL = previousBase;
  }
});
