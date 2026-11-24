const test = require('node:test');
const assert = require('node:assert/strict');
const { namePattern, pickDuplicateJobs } = require('../src/utils/duplicateJobs');

function job(overrides = {}) {
  return {
    _id: 'job-1',
    title: '4632 E Bradford · White oak rail system',
    stage: 'ESTIMATE_IN_PROGRESS',
    jobAddress: { street: '4632 E. Bradford', city: 'Orange' },
    customer: { name: 'Celso Montillo', address: { street: '100 Old St', city: 'Orange' } },
    ...overrides,
  };
}

test('a copied worksheet matches the existing job by name and street', () => {
  const matches = pickDuplicateJobs([job()], {
    name: 'celso  montillo',
    street: '4632 E Bradford',
    city: 'orange',
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, '4632 E Bradford · White oak rail system');
  assert.equal(matches[0].street, '4632 E. Bradford');
  assert.equal(matches[0].city, 'Orange');
  assert.equal(matches[0].stateLabel, 'Estimate In Progress');
});

test('a different city, a different name, or a missing street is not a duplicate', () => {
  const jobs = [job()];
  assert.deepEqual(pickDuplicateJobs(jobs, { name: 'Celso Montillo', street: '4632 E Bradford', city: 'Tustin' }), []);
  assert.deepEqual(pickDuplicateJobs(jobs, { name: 'Joseph Montillo', street: '4632 E Bradford', city: 'Orange' }), []);
  assert.deepEqual(pickDuplicateJobs(jobs, { name: 'Celso Montillo', street: '', city: 'Orange' }), []);
});

test('a blank entered city still matches, and a job with no site uses the customer address', () => {
  const atHome = job({
    _id: 'job-2',
    title: 'Stair repair',
    stage: 'JOB_COMPLETED',
    isCompletedClosedOut: true,
    jobAddress: {},
  });
  const matches = pickDuplicateJobs([atHome], { name: 'Celso Montillo', street: '100 Old St', city: '' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].street, '100 Old St');
  assert.equal(matches[0].stateLabel, 'Completed');
});

test('archived and dead jobs stay in the warning', () => {
  const matches = pickDuplicateJobs(
    [job({ isArchived: true, stage: 'ESTIMATE_SENT' }), job({ _id: 'job-2', isDeadEstimate: true })],
    { name: 'Celso Montillo', street: '4632 E Bradford' },
  );
  assert.deepEqual(
    matches.map((match) => match.stateLabel),
    ['Archived', 'Dead estimate'],
  );
});

test('the customer lookup matches the whole name only', () => {
  assert.equal(namePattern('Celso Montillo').test('celso   montillo'), true);
  assert.equal(namePattern('Celso Montillo').test('Celso Montillo Jr'), false);
  assert.equal(namePattern(''), null);
});
