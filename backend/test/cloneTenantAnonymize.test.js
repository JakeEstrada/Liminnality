const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { anonymizeByCollection } = require('../src/scripts/cloneTenant');

test('anonymize replaces identity fields and does not keep the source password', async () => {
  const user = {
    _id: 'abc123',
    name: 'Jane Shop',
    email: 'jane@shop.example',
    mobile: '9495550100',
    address: '214 Avenida Del Mar',
    password: await bcrypt.hash('real-password', 4),
  };
  anonymizeByCollection('users', user, 0, { targetSlug: 'demo' });
  assert.equal(user.name, 'Demo User 1');
  assert.match(user.email, /@example\.com$/);
  assert.equal(user.mobile, '');
  assert.equal(user.address, '');
  assert.equal(await bcrypt.compare('real-password', user.password), false);

  const customer = {
    name: 'John Smith',
    primaryPhone: '9495550142',
    primaryEmail: 'john@email.com',
    notes: 'gate is 1234',
    gateCode: '1234',
    address: { street: '214 Avenida Del Mar', city: 'San Clemente', state: 'CA', zip: '92672' },
  };
  anonymizeByCollection('customers', customer, 0);
  assert.equal(customer.name, 'Customer 1');
  assert.equal(customer.notes, '');
  assert.equal(customer.gateCode, '');
  assert.equal(customer.address.street, '101 Demo Street');
  assert.equal(customer.address.city, 'San Clemente');

  const job = {
    title: 'Smith stairs',
    description: 'Call John at home',
    jobAddress: { street: '214 Avenida Del Mar' },
    notes: [{ content: 'Customer cell 9495550142', createdByName: 'Jane' }],
  };
  anonymizeByCollection('jobs', job, 0);
  assert.equal(job.title, 'Job 1');
  assert.equal(job.description, '');
  assert.equal(job.notes[0].content, 'Note');
});
