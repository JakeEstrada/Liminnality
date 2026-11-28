const test = require('node:test');
const assert = require('node:assert/strict');
const { anonymizeValue, buildDemoContext, collectFromValue, formatLike, maskTenDigits } = require('../src/utils/demoAnonymize');

test('a phone keeps the area code and the last four digits', () => {
  assert.equal(maskTenDigits('9497960113'), '9495550113');
  assert.equal(formatLike('(949)796-0113', '9495550113'), '(949)555-0113');
  assert.equal(formatLike('949-796-0113', '9495550113'), '949-555-0113');
  assert.equal(formatLike('+19497960113', '9495550113'), '+19495550113');
  assert.equal(formatLike('9497960113', '9495550113'), '9495550113');
});

test('two numbers that share a last four stay different', () => {
  const bucket = { names: [], phones: [], streets: [], emails: [], protectedEmails: [] };
  collectFromValue({ primaryPhone: '(949)796-0113', mobile: '949-111-0113' }, bucket);
  const ctx = buildDemoContext(bucket);
  assert.equal(ctx.phoneCollisions, 1);
  const masked = [...ctx.phoneMap.values()];
  assert.equal(new Set(masked).size, 2);
  assert.ok(masked.includes('9495550113'));
});

test('streets change, coordinates and prices stay, and the job text keeps sizes', () => {
  const doc = {
    title: 'Smith oak stair 6084',
    valueContracted: 11900,
    description: 'Call (949)796-0113 about 4.25 posts. Total $11,900.',
    jobAddress: { street: '214 Avenida Del Mar', city: 'San Clemente', state: 'CA', zip: '92672' },
    geo: { lat: 33.42, lng: -117.61, sourceAddress: '214 Avenida Del Mar, San Clemente, CA 92672' },
    notes: [{ content: 'Jose Avila will reuse the original newels.', createdByName: 'Jake Estrada' }],
    gateCode: '4321',
    customerEmail: 'jose@example.net',
  };
  const bucket = { names: [], phones: [], streets: [], emails: [], protectedEmails: [] };
  collectFromValue(doc, bucket);
  bucket.names.push('Jose Avila', 'Jake Estrada', 'John Smith');
  const ctx = buildDemoContext(bucket);
  const next = anonymizeValue(doc, ctx, '', 'jobs');

  assert.equal(next.valueContracted, 11900);
  assert.equal(next.geo.lat, 33.42);
  assert.equal(next.geo.lng, -117.61);
  assert.equal(next.jobAddress.city, 'San Clemente');
  assert.equal(next.jobAddress.zip, '92672');
  assert.notEqual(next.jobAddress.street, '214 Avenida Del Mar');
  assert.match(next.geo.sourceAddress, /San Clemente/);
  assert.doesNotMatch(next.geo.sourceAddress, /Avenida Del Mar/);
  assert.match(next.description, /\(949\)555-0113/);
  assert.match(next.description, /4\.25/);
  assert.match(next.description, /\$11,900/);
  assert.match(next.title, /6084/);
  assert.doesNotMatch(next.title, /Smith/);
  assert.equal(next.gateCode, '');
  assert.doesNotMatch(next.notes[0].content, /Jose|Avila/);
  assert.doesNotMatch(next.notes[0].createdByName, /Jake|Estrada/);
  assert.match(next.customerEmail, /@example\.com$/);
});

test('a street written as the job title changes, and the login survives the username', () => {
  const doc = {
    title: '3832 Holden Cir railing 6084',
    description: '4.25 posts at 214 Avenida Del Mar',
    valueContracted: 8500,
    geo: { lat: 33.5, lng: -117.7 },
  };
  const user = { name: 'scww', email: 'scww+copy', mobile: '(949)796-0113' };
  const bucket = { names: [], phones: [], streets: [], emails: [], protectedEmails: [] };
  collectFromValue(doc, bucket, '', 'jobs');
  collectFromValue(user, bucket, '', 'users');
  bucket.names.push('Ryan');
  const ctx = buildDemoContext(bucket);
  const next = anonymizeValue(doc, ctx, '', 'jobs');
  const nextUser = anonymizeValue(user, ctx, '', 'users');
  assert.equal(next.geo.lat, 33.5);
  assert.equal(next.valueContracted, 8500);
  assert.match(next.title, /6084/);
  assert.doesNotMatch(next.title, /Holden/);
  assert.doesNotMatch(next.description, /Avenida/);
  assert.match(next.description, /4\.25/);
  assert.equal(nextUser.email, 'scww+copy');
  assert.match(nextUser.mobile, /555/);
  const ryan = anonymizeValue({ displayName: 'Ryan' }, ctx, '', 'rfidphones');
  assert.doesNotMatch(ryan.displayName, /Demo Company|Ryan/);
});
