const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeWorksheetDraft, titleFromFilename } = require('../src/utils/worksheetDraft');

test('filename after worksheet becomes a fallback title', () => {
  assert.equal(titleFromFilename('SCWW_New_era_const_worksheet__Bradford.pdf'), 'Bradford');
  assert.equal(titleFromFilename('photo.jpg'), '');
});

test('worksheet draft keeps the customer and drops the shop header', () => {
  const draft = sanitizeWorksheetDraft(
    {
      title: '4632 E Bradford',
      customerName: 'Celso Montillo',
      customerPhone: '(714) 741-1828',
      customerEmail: 'Celso.Montillo@aol.com',
      street: '4632 E Bradford',
      city: 'Orange',
      state: 'ca',
      zip: '92867',
      valueEstimated: '$11,200',
      source: 'referral',
      referralCompany: 'Daniel',
      extraNote: 'Joseph 909-916-8804',
    },
    'SCWW_New_era_const_worksheet__Bradford.pdf',
  );

  assert.equal(draft.title, '4632 E Bradford');
  assert.equal(draft.customerName, 'Celso Montillo');
  assert.equal(draft.customerPhone, '7147411828');
  assert.equal(draft.customerEmail, 'celso.montillo@aol.com');
  assert.equal(draft.city, 'Orange');
  assert.equal(draft.state, 'CA');
  assert.equal(draft.valueEstimated, '11200');
  assert.equal(draft.source, 'referral');
  assert.equal(draft.referralCompany, 'Daniel');
  assert.equal(draft.extraNote, 'Joseph 909-916-8804');
});

test('shop phone and email are left blank', () => {
  const draft = sanitizeWorksheetDraft({
    customerPhone: '951-491-1137',
    customerEmail: 'Mystairguy@gmail.com',
    source: 'friend',
    referralCompany: 'Daniel',
    valueEstimated: 30,
  });
  assert.equal(draft.customerPhone, '');
  assert.equal(draft.customerEmail, '');
  assert.equal(draft.source, 'referral');
  assert.equal(draft.referralCompany, 'Daniel');
  assert.equal(draft.valueEstimated, '30');
});
