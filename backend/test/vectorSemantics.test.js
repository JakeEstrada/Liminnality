const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatVectorPreview,
  selectExampleRow,
  listJobsWithVectors,
  describeJobList,
  nearestOtherJobs,
  otherLinesOnJob,
  describeExample,
  describeLine,
  buildVectorDetail,
  answerVectorQuestion,
  rankJobPopularity,
  describePopularity,
} = require('../src/utils/vectorSemantics');

const rows = [
  {
    _id: 'line-a',
    jobId: 'job-a',
    kind: 'worksheet',
    text: 'Scope: Install iron balusters on the stair',
    embedding: [1, 0],
  },
  {
    _id: 'line-b',
    jobId: 'job-a',
    kind: 'note',
    text: 'Gate code is 4412',
    embedding: [0, 1],
  },
  {
    _id: 'line-c',
    jobId: 'job-b',
    kind: 'note',
    text: 'Order iron balusters from HOF',
    embedding: [0.9, 0.1],
  },
  {
    _id: 'line-d',
    jobId: 'job-c',
    kind: 'note',
    text: 'Paint the landing',
    embedding: [0, 1],
  },
];

const jobs = new Map([
  ['job-a', { jobTitle: 'North stair rail', customerName: 'North' }],
  ['job-b', { jobTitle: 'Scott Lester', customerName: 'Scott Lester' }],
  ['job-c', { jobTitle: 'Paint landing', customerName: 'Paint landing' }],
]);

test('every job with a stored line is listed once', () => {
  const listed = describeJobList(listJobsWithVectors(rows), jobs);
  assert.deepEqual(listed.map((job) => job.jobTitle), ['North stair rail', 'Paint landing', 'Scott Lester']);
  assert.equal(listed.find((job) => job.jobId === 'job-a').lineCount, 2);
  assert.equal(listed.find((job) => job.jobId === 'job-a').memoryId, 'line-a');
});

test('a vector preview is the first numbers and an ellipsis', () => {
  assert.equal(formatVectorPreview([0.153, -0.224, 0.308, 0.01], 3), '<0.15, -0.22, 0.31, ……>');
});

test('the closest other job is the nearer list, and the same job stays out', () => {
  const example = selectExampleRow(rows, { jobIds: ['job-a'] });
  assert.equal(example._id, 'line-a');
  const near = nearestOtherJobs(example, rows, 2);
  assert.equal(near[0].row.jobId, 'job-b');
  assert.ok(near[0].score > 0.9);
  assert.equal(near.some((hit) => hit.row.jobId === 'job-a'), false);
  const same = otherLinesOnJob(example, rows, 4);
  assert.equal(same.length, 1);
  assert.equal(same[0].row._id, 'line-b');
});

test('the writeup names the line and says a number is not a word', () => {
  const example = describeExample(rows[0], jobs);
  const neighbors = nearestOtherJobs(rows[0], rows, 1).map((hit) => describeLine(hit.row, jobs, hit.score));
  const detail = buildVectorDetail(example, neighbors, [], { model: 'text-embedding-3-small', storedLines: 4 });
  const text = detail.join('\n');
  assert.match(example.previewText, /^<0\.|-<|^<-?[0-9]/);
  assert.match(text, /North stair rail/);
  assert.match(text, /not a word/);
  assert.match(text, /Scott Lester/);
  assert.match(text, /iron/);
  assert.match(text, /instead of/);
});

test('a similarity question stays on the stored lines', () => {
  const example = describeExample(rows[0], jobs);
  const neighbors = nearestOtherJobs(rows[0], rows, 1).map((hit) => describeLine(hit.row, jobs, hit.score));
  const reply = answerVectorQuestion('why is this similar, not a different stair?', example, neighbors);
  assert.match(reply, /Scott Lester/);
  assert.match(reply, /0\.9/);
  assert.match(reply, /instead of/);
  const numbers = answerVectorQuestion('what is one of these numbers?', example, neighbors);
  assert.match(numbers, /not a word/);
  assert.match(numbers, /job-a/);
});

test('the densest group is the popular kind of job and a lone job is not', () => {
  const crowd = [
    { _id: 'a', jobId: 'job-a', kind: 'worksheet', text: 'Scope: white oak rail with iron balusters', embedding: [1, 0] },
    { _id: 'b', jobId: 'job-b', kind: 'worksheet', text: 'Scope: white oak rail and iron balusters', embedding: [1, 0] },
    { _id: 'c', jobId: 'job-c', kind: 'worksheet', text: 'Install oak rail, iron balusters', embedding: [0.99, 0.01] },
    { _id: 'e', jobId: 'job-e', kind: 'worksheet', text: 'Curved handrail and wrought spindles', embedding: [0.98, 0.2] },
    { _id: 'd', jobId: 'job-d', kind: 'worksheet', text: 'Glass shower panel', embedding: [0, 1] },
  ];
  const labels = new Map([
    ['job-a', { jobTitle: 'North stair', customerName: 'North' }],
    ['job-b', { jobTitle: 'Scott Lester', customerName: 'Scott Lester' }],
    ['job-c', { jobTitle: 'Oak rail', customerName: 'Taylor' }],
    ['job-e', { jobTitle: 'Curved rail', customerName: 'Diaz' }],
    ['job-d', { jobTitle: 'Glass shower', customerName: 'Glass shower' }],
  ]);
  const report = describePopularity(rankJobPopularity(crowd), labels);
  assert.ok(report.most.count >= 3);
  assert.equal(report.most.jobs.some((job) => job.jobId === 'job-e'), true);
  assert.equal(report.most.jobs.some((job) => job.jobId === 'job-d'), false);
  assert.ok(report.most.shared.includes('oak') || report.most.shared.includes('baluster'));
  assert.match(report.most.say, /densest group/);
  assert.equal(report.least.jobs[0].jobId, 'job-d');
  assert.match(report.least.say, /Glass shower/);
});
