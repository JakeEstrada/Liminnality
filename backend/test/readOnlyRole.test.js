const test = require('node:test');
const assert = require('node:assert/strict');
const { readOnlyRequestAllowed } = require('../src/middleware/auth');

test('read-only accounts can load data and sign out, and cannot write jobs', () => {
  assert.equal(readOnlyRequestAllowed('GET', '/api/jobs'), true);
  assert.equal(readOnlyRequestAllowed('POST', '/api/auth/logout'), true);
  assert.equal(readOnlyRequestAllowed('POST', '/audit-logs'), true);
  assert.equal(readOnlyRequestAllowed('POST', '/api/tts/speech'), true);
  assert.equal(readOnlyRequestAllowed('POST', '/api/jobs'), false);
  assert.equal(readOnlyRequestAllowed('PATCH', '/api/jobs/abc'), false);
  assert.equal(readOnlyRequestAllowed('DELETE', '/api/customers/abc'), false);
  assert.equal(readOnlyRequestAllowed('POST', '/api/twilio/send-sms'), false);
});
