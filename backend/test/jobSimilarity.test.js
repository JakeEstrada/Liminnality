const test = require('node:test');
const assert = require('node:assert/strict');
const {
  looksLikeWorksheetNote,
  worksheetFingerprintText,
  cosineSimilarity,
  rankFingerprints,
  noteSnippet,
} = require('../src/utils/jobSimilarity');

test('a worksheet note is recognized by its labeled lines', () => {
  assert.equal(looksLikeWorksheetNote('Scope: Install 19 ft rail'), true);
  assert.equal(looksLikeWorksheetNote('Gate code: 4455\nScope: rail'), true);
  assert.equal(looksLikeWorksheetNote('Called the customer about the deposit'), false);
  assert.equal(looksLikeWorksheetNote('Stage updated: Estimate Sent → Contract Out'), false);
});

test('the fingerprint keeps the worksheet note and skips texts, stage changes, and appointments', () => {
  const text = worksheetFingerprintText([
    { content: 'Scope: White oak rail\nOptions: Post To Post', isWorksheet: true },
    { content: 'Scope: this text was an SMS', isSms: true },
    { content: 'Stage updated: Estimate Sent → Job Prep', isStageChange: true },
    { content: 'Appointment Tuesday', isAppointment: true },
    { content: 'Customer asked for a callback' },
  ]);
  assert.equal(text, 'Scope: White oak rail\nOptions: Post To Post');
});

test('an older worksheet note is included from its wording when it has no flag', () => {
  const text = worksheetFingerprintText([
    { content: 'Worksheet date: 11-12-26\nMarked Contractor on the worksheet' },
  ]);
  assert.match(text, /Worksheet date: 11-12-26/);
});

test('identical directions score 1 and perpendicular directions score 0', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1], [1, 0]), 0);
  assert.equal(cosineSimilarity([], [1]), 0);
});

test('ranking skips the open job and weak matches', () => {
  const ranked = rankFingerprints(
    [1, 0],
    [
      { jobId: 'self', embedding: [1, 0], text: 'Scope: this job' },
      { jobId: 'close', embedding: [0.9, 0.1], text: 'Scope: oak rail' },
      { jobId: 'far', embedding: [0, 1], text: 'Scope: unrelated' },
    ],
    { excludeJobId: 'self', limit: 5, minScore: 0.45 },
  );
  assert.deepEqual(
    ranked.map((row) => row.jobId),
    ['close'],
  );
  assert.ok(ranked[0].score > 0.9);
});

test('a long note is shortened for the result list', () => {
  const snippet = noteSnippet(`Scope: ${'rail '.repeat(80)}`);
  assert.ok(snippet.length <= 220);
  assert.match(snippet, /\.\.\.$/);
});
