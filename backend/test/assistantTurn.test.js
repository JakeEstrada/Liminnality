const test = require('node:test');
const assert = require('node:assert/strict');
const { isGreeting, greetingReply } = require('../src/utils/assistantTurn');

test('a spoken hello is a greeting', () => {
  assert.equal(isGreeting('hey hello'), true);
  assert.equal(isGreeting('Hi there.'), true);
  assert.equal(isGreeting('what jobs ordered balusters'), false);
  assert.match(greetingReply(), /Hello/);
});
