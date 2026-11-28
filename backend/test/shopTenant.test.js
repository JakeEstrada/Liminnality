const test = require('node:test');
const assert = require('node:assert/strict');
const { pickPreferredTenantId } = require('../src/utils/shopTenant');

test('a shared phone stays with the original shop when that shop is one of the matches', () => {
  const original = '69c1eb8214c17afd3f01ecf3';
  const copy = '69c1ebd6e4d139ef44c48fd6';
  assert.equal(pickPreferredTenantId([copy, original], original), original);
  assert.equal(pickPreferredTenantId([copy], original), copy);
  assert.equal(pickPreferredTenantId([], original), '');
});
