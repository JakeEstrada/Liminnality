const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldStoreHourlyRate } = require('../src/utils/hourlyRate');

test('a positive hourly rate is stored', () => {
  assert.equal(shouldStoreHourlyRate('22'), true);
  assert.equal(shouldStoreHourlyRate('22.50'), true);
  assert.equal(shouldStoreHourlyRate(' 18 '), true);
});

test('a blank or zero hourly rate is not stored over an existing one', () => {
  assert.equal(shouldStoreHourlyRate(''), false);
  assert.equal(shouldStoreHourlyRate('0'), false);
  assert.equal(shouldStoreHourlyRate('0.00'), false);
  assert.equal(shouldStoreHourlyRate('abc'), false);
  assert.equal(shouldStoreHourlyRate(null), false);
});
