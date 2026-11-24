const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorksheetResult, cleanEmail, moneyValue, titleFromFilename } = require('../src/utils/worksheetDraft');

function field(text, unclear = false, reason = '') {
  return { text, unclear, reason };
}

function bradfordReading(overrides = {}) {
  return {
    pageTurn: 'upright',
    isScwwWorksheet: true,
    customerName: field('Celso Montillo', true, 'Last name taken from the email'),
    customerPhone: field('714-391-1828', true, 'middle group 391 or 341'),
    customerEmail: field('celso.montillo@aol'),
    street: field('4632 E Bradford Orange'),
    city: field('Orange'),
    state: field(''),
    zip: field(''),
    ref: field('Daniel'),
    worksheetDate: field('11-2-26'),
    total: field('11,900:'),
    customerType: 'customer',
    options: [
      { label: 'Over the Post', checked: false },
      { label: 'Post To Post', checked: true },
      { label: 'Customer', checked: true },
      { label: 'Accepted', checked: true },
    ],
    materials: [
      { item: 'Handrail', wood: 'White Oak', finish: '', quantity: '30', note: '6084' },
      { item: 'Balusters', wood: 'X', finish: 'Blk', quantity: '75', note: 'Iron Alto' },
      { item: 'Newel', wood: 'White Oak', finish: '', quantity: '6', note: 'Channel Cap' },
    ],
    scopeLines: ['Install 30 ft white oak rail system w/ iron balusters as described'],
    scopeTitle: 'white oak rail and iron balusters',
    otherContacts: [
      { name: 'joseph', phone: 'H. 909-816-8804', email: '', note: '', unclear: false, reason: '' },
      { name: 'Celso', phone: '714-391-1828', email: '', note: '', unclear: false, reason: '' },
    ],
    notes: ['Sketch: 43', 'Post To Post checked'],
    ...overrides,
  };
}

test('filename after worksheet becomes a fallback title', () => {
  assert.equal(titleFromFilename('SCWW_New_era_const_worksheet__Bradford.pdf'), 'Bradford');
  assert.equal(titleFromFilename('photo.jpg'), '');
});

test('money keeps the written total and drops trailing marks', () => {
  assert.equal(moneyValue('11,900:'), '11900');
  assert.equal(moneyValue('11900.'), '11900');
  assert.equal(moneyValue('$4,250.50'), '4250.50');
  assert.equal(moneyValue('about 30 ft'), '');
});

test('incomplete email stays as written with a suggested ending', () => {
  assert.deepEqual(cleanEmail('Celso.montillo@ AOL'), {
    value: 'celso.montillo@aol',
    problem: 'Email looks incomplete',
    suggestion: 'celso.montillo@aol.com',
  });
  assert.equal(cleanEmail('Mystairguy@gmail.com').value, '');
});

test('Bradford worksheet becomes an editable draft with Verify flags', () => {
  const result = buildWorksheetResult(bradfordReading(), null, 'SCWW_New_era_const_worksheet__Bradford.pdf');
  const { draft, verify, suggestions, review } = result;

  assert.equal(draft.title, '4632 E Bradford · White oak rail and iron balusters');
  assert.equal(draft.customerName, 'Celso Montillo');
  assert.equal(draft.customerPhone, '7143911828');
  assert.equal(draft.customerEmail, 'celso.montillo@aol');
  assert.equal(draft.street, '4632 E Bradford');
  assert.equal(draft.city, 'Orange');
  assert.equal(draft.state, '');
  assert.equal(draft.zip, '');
  assert.equal(draft.valueEstimated, '11900');
  assert.equal(draft.source, 'referral');
  assert.equal(draft.referralCompany, 'Daniel');

  assert.equal(verify.customerEmail, 'Email looks incomplete');
  assert.equal(suggestions.customerEmail, 'celso.montillo@aol.com');
  assert.equal(verify.customerPhone, 'middle group 391 or 341');
  assert.equal(verify.customerName, 'Last name taken from the email');
  assert.equal(verify.city, undefined);
  assert.equal(verify.valueEstimated, undefined);

  assert.equal(draft.description, undefined);

  assert.deepEqual(review.scopeLines, ['Install 30 ft white oak rail system w/ iron balusters as described']);
  assert.deepEqual(review.options, ['Post To Post']);
  assert.ok(review.materials.includes('Balusters: Blk, qty 75, Iron Alto'));
  assert.deepEqual(review.notes, []);
  assert.equal(review.materialsVerify, '');
  assert.equal(review.otherContacts.length, 1);
  assert.equal(review.otherContacts[0].name, 'Joseph');
  assert.equal(review.otherContacts[0].phone, '909-816-8804');
  assert.equal(review.otherContacts[0].note, 'H.');
  assert.equal(review.referral, 'Daniel');
  assert.equal(review.customerType, 'customer');
});

test('a second read flags fields and quantities where the two disagree', () => {
  const check = bradfordReading({
    customerName: field('Celso Montillo'),
    street: field('4632 E Broadland'),
    total: field('11,900'),
    materials: [{ item: 'Balusters', wood: '', finish: 'Blk', quantity: '25', note: 'Iron' }],
    otherContacts: [{ name: 'Joseph', phone: '909-846-8804', email: '', note: 'H.', unclear: false, reason: '' }],
  });
  const result = buildWorksheetResult(bradfordReading(), check, 'worksheet.pdf');

  assert.equal(result.verify.street, 'Could also read as "4632 E Broadland"');
  assert.equal(result.verify.valueEstimated, undefined);
  assert.equal(result.verify.description, undefined);
  assert.equal(result.review.materialsVerify, 'Balusters quantity could be 75 or 25');
  assert.equal(result.review.otherContacts[0].verify, 'Phone could also read as 909-846-8804');
});

test('shop header details never become the customer', () => {
  const result = buildWorksheetResult(
    bradfordReading({
      customerName: field('Joe Toombs'),
      customerPhone: field('951-491-1137'),
      customerEmail: field('Mystairguy@gmail.com'),
      ref: field(''),
      total: field(''),
    }),
  );
  assert.equal(result.draft.customerName, '');
  assert.equal(result.draft.customerPhone, '');
  assert.equal(result.draft.customerEmail, '');
  assert.equal(result.draft.source, 'other');
  assert.equal(result.draft.valueEstimated, '');
  assert.deepEqual(result.verify, {});
});

test('a gate code written in the notes is kept, and the other notes stay', () => {
  const result = buildWorksheetResult(
    bradfordReading({
      gateCode: field(''),
      notes: ['Sketch: 43', 'Gate code: #4455', 'Dogs in the back'],
    }),
  );
  assert.equal(result.draft.gateCode, '4455');
  assert.equal(result.review.gateCode, '4455');
  assert.deepEqual(result.review.notes, ['Dogs in the back']);
  assert.equal(result.verify.gateCode, undefined);
});

test('an unclear gate code stays flagged', () => {
  const result = buildWorksheetResult(bradfordReading({ gateCode: field('#4455', true, '4 or 9') }));
  assert.equal(result.draft.gateCode, '4455');
  assert.equal(result.verify.gateCode, '4 or 9');
});

test('a second read flags a gate code the two reads do not share', () => {
  const agreed = buildWorksheetResult(
    bradfordReading({ gateCode: field('4455') }),
    bradfordReading({ gateCode: field('#4455') }),
  );
  assert.equal(agreed.verify.gateCode, undefined);

  const disputed = buildWorksheetResult(
    bradfordReading({ gateCode: field('4455') }),
    bradfordReading({ gateCode: field('4459') }),
  );
  assert.equal(disputed.verify.gateCode, 'Could also read as "4459"');

  const oneRead = buildWorksheetResult(
    bradfordReading({ gateCode: field('') }),
    bradfordReading({ gateCode: field('2214') }),
  );
  assert.equal(oneRead.draft.gateCode, '2214');
  assert.equal(oneRead.verify.gateCode, 'Only one of two reads found this');
});

test('sideways pages report how to turn them', () => {
  assert.equal(buildWorksheetResult(bradfordReading({ pageTurn: 'turn_counterclockwise' })).pageTurn, -90);
  assert.equal(buildWorksheetResult(bradfordReading({ pageTurn: 'upside_down' })).pageTurn, 180);
});
