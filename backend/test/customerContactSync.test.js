const test = require('node:test');
const assert = require('node:assert/strict');
const { replacementForRemovedJobEmail } = require('../src/utils/customerContactSync');

test('replaces a job email that was removed from the customer', () => {
  const previous = {
    primaryEmail: 'genevieveispasc@yahoo.com',
    contactEmails: [{ value: 'genevieveispasc@yahoo.com' }, { value: 'genevieveispas@yahoo.com' }],
  };
  const next = {
    primaryEmail: 'genevieveispas@yahoo.com',
    contactEmails: [{ value: 'genevieveispas@yahoo.com' }],
  };
  assert.equal(
    replacementForRemovedJobEmail('Genevieveispasc@yahoo.com', previous, next),
    'genevieveispas@yahoo.com',
  );
});

test('keeps a job email that is still on the customer', () => {
  const customer = {
    primaryEmail: 'genevieveispas@yahoo.com',
    contactEmails: [{ value: 'genevieveispas@yahoo.com' }],
  };
  assert.equal(replacementForRemovedJobEmail('genevieveispas@yahoo.com', customer, customer), null);
});

test('keeps a job-only email that was never on the customer', () => {
  const previous = { primaryEmail: 'owner@example.com', contactEmails: [{ value: 'owner@example.com' }] };
  const next = { primaryEmail: 'owner@example.com', contactEmails: [{ value: 'owner@example.com' }] };
  assert.equal(replacementForRemovedJobEmail('site@example.com', previous, next), null);
});
