const test = require('node:test');
const assert = require('node:assert/strict');
const {
  keywordStems,
  textHasStems,
  exactTokens,
  textHasExactTokens,
  rankExactMatches,
  isStageLog,
  asksAboutOrders,
  lineMentionsOrder,
  shopWeekLabel,
  shopWeekContaining,
  parseShopBound,
  rankMemoryHits,
  jobMemoryRows,
  taskMemoryRow,
} = require('../src/utils/jobMemoryQuery');

test('a baluster question keeps the material and the order word', () => {
  assert.deepEqual(keywordStems('What jobs did I order balusters for last week?'), ['order', 'baluster']);
  assert.equal(textHasStems('Order iron balusters for the stair', ['order', 'baluster']), true);
  assert.equal(textHasStems('Install iron balusters', ['order', 'baluster']), false);
  assert.equal(textHasStems('Install iron balusters', ['baluster']), true);
});

test('shop week is Friday through Thursday', () => {
  assert.deepEqual(shopWeekContaining('2026-11-27'), { start: '2026-11-27', end: '2026-12-03' });
  const label = shopWeekLabel(new Date('2026-11-27T20:00:00Z'));
  assert.equal(label.today, '2026-11-27');
  assert.equal(label.weekday, 'Friday');
  assert.deepEqual(label.lastWeek, { start: '2026-11-20', end: '2026-11-26' });
  const end = parseShopBound('2026-11-26', true);
  assert.equal(end.toISOString(), '2026-11-27T07:59:59.999Z');
});

test('a closer vector outranks a loose one and keeps a single job', () => {
  const hits = rankMemoryHits([1, 0], [
    { jobId: 'far', text: 'unrelated', embedding: [0, 1] },
    { jobId: 'close', text: 'picked up the spindles', embedding: [0.9, 0.1] },
    { jobId: 'close', text: 'weaker line on the same job', embedding: [0.6, 0.4] },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].row.text, 'picked up the spindles');
  assert.ok(hits[0].score > 0.9);
});

test('worksheet text, notes, and tasks stay tied to the job', () => {
  const rows = jobMemoryRows({
    updatedAt: new Date('2026-11-21T18:00:00Z'),
    schedule: { crewNotes: 'Pick up the landing tread' },
    notes: [
      {
        _id: 'note-1',
        content: 'Scope: Install iron balusters',
        isWorksheet: true,
        createdAt: new Date('2026-11-27T16:00:00Z'),
      },
      {
        _id: 'note-2',
        content: 'Ordered balusters from the vendor',
        createdAt: new Date('2026-11-24T16:00:00Z'),
      },
      {
        _id: 'note-3',
        content: 'Stage updated: Estimate Sent → Job Prep',
        isStageChange: true,
        createdAt: new Date('2026-11-24T18:00:00Z'),
      },
    ],
  });
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['worksheet', 'note', 'crew'],
  );
  assert.equal(isStageLog('Stage updated: Estimate Sent → Job Prep'), true);
  assert.equal(asksAboutOrders('orders of the previous week'), true);
  assert.equal(lineMentionsOrder('Ordered balusters from the vendor'), true);
  assert.equal(lineMentionsOrder('Stage updated: Estimate Sent → Job Prep'), false);
  assert.equal(rows[1].sourceId, 'note-2');

  const task = taskMemoryRow({
    _id: 'task-1',
    jobId: 'job-1',
    title: 'Order balusters',
    description: 'Iron, 1/2 inch',
    createdAt: new Date('2026-11-20T16:00:00Z'),
    completedAt: new Date('2026-11-25T16:00:00Z'),
  });
  assert.equal(task.jobId, 'job-1');
  assert.equal(task.kind, 'task');
  assert.match(task.text, /Order balusters/);
  assert.equal(task.at.toISOString(), '2026-11-25T16:00:00.000Z');
  assert.equal(taskMemoryRow({ _id: 'task-2', title: 'Shop todo' }), null);
});

test('a part number and a size match the worksheet line exactly, newest date first', () => {
  const newer = 'Scope: Install White Oak rail system w/ Blk Iron wound balusters Upgrade to 4.5" Oak newel post Add Float baluster Shoes Handrail: White Oak, qty 12, Curved #7084 Balusters: P.G., qty 31, Blk Iron w/ Flat shoes Newel: White Oak, 4.5" Post Cap: Channel cut Ref: Armin - James Remodeling Worksheet date: 01-22-26 End Treads, skirt, & Carpet stay';
  const older = 'Handrail: White Oak, Curved #7084 Worksheet date: 06-02-25';
  const quarter = 'Upgrade to 4.25" Oak newel post Worksheet date: 03-01-26';
  const rows = [
    { _id: 'older', jobId: 'older-job', kind: 'worksheet', text: older, at: new Date('2026-11-27T00:00:00Z') },
    { _id: 'newer', jobId: 'newer-job', kind: 'worksheet', text: newer, at: new Date('2026-11-27T00:00:00Z') },
    { _id: 'quarter', jobId: 'quarter-job', kind: 'worksheet', text: quarter, at: new Date('2026-11-27T00:00:00Z') },
  ];
  assert.deepEqual(exactTokens('Can you list the most recent 7084 jobs'), ['7084']);
  assert.deepEqual(exactTokens('4.25" newel posts jobs'), ['4.25']);
  assert.equal(textHasExactTokens(newer, ['4.25']), false);
  assert.equal(textHasExactTokens(newer, ['4.5']), true);
  assert.equal(textHasExactTokens('code 17084', ['7084']), false);

  const codes = rankExactMatches(rows, 'most recent 7084 jobs');
  assert.deepEqual(codes.map((hit) => hit.row.jobId), ['newer-job', 'older-job']);
  const sizes = rankExactMatches(rows, '4.25" newel posts jobs');
  assert.deepEqual(sizes.map((hit) => hit.row.jobId), ['quarter-job']);
  const half = rankExactMatches(rows, '4.5" newel posts');
  assert.deepEqual(half.map((hit) => hit.row.jobId), ['newer-job']);
});

test('worksheet words match even when the ending differs', () => {
  const sheet = 'Scope: Solid wood treads, skirting, false treads, and square nose. Carpet stay.';
  const plain = 'Install oak treads only';
  const rows = [
    { _id: 'sheet', jobId: 'sheet-job', kind: 'worksheet', text: sheet },
    { _id: 'plain', jobId: 'plain-job', kind: 'note', text: plain },
  ];
  assert.deepEqual(rankExactMatches(rows, 'skirting').map((hit) => hit.row.jobId), ['sheet-job']);
  assert.deepEqual(rankExactMatches(rows, 'false treads').map((hit) => hit.row.jobId), ['sheet-job']);
  assert.deepEqual(rankExactMatches(rows, 'square nose').map((hit) => hit.row.jobId), ['sheet-job']);
  assert.deepEqual(rankExactMatches(rows, 'solid wood treads').map((hit) => hit.row.jobId), ['sheet-job']);
  assert.deepEqual(rankExactMatches(rows, 'false treads').some((hit) => hit.row.jobId === 'plain-job'), false);
});
