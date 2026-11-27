const test = require('node:test');
const assert = require('node:assert/strict');
const { worksheetJobNote } = require('../src/utils/worksheetNote');

test('a worksheet note keeps scope, materials, and the other lines in order', () => {
  const note = worksheetJobNote(
    {
      scopeLines: ['Install 30 Ft white oak rail system w/ Iron balusters As described'],
      options: ['Post To Post'],
      materials: ['Handrail: White Oak, qty 30, 6084', 'Balusters: White Oak, Blk, qty 75, Jvon Alto'],
      materialsVerify: 'Balusters quantity could be 75 or 25',
      otherContacts: [{ name: 'Joseph', phone: '909-846-8804', email: '', note: 'H.' }],
      referral: 'Daniel',
      worksheetDate: '11-2-26',
      customerType: 'customer',
      notes: [],
    },
    '',
  );
  assert.equal(
    note,
    [
      'Scope: Install 30 Ft white oak rail system w/ Iron balusters As described',
      'Options: Post To Post',
      'Handrail: White Oak, qty 30, 6084',
      'Balusters: White Oak, Blk, qty 75, Jvon Alto',
      'Balusters quantity could be 75 or 25',
      'Other contact: Joseph · 909-846-8804 · H.',
      'Ref: Daniel',
      'Worksheet date: 11-2-26',
    ].join('\n'),
  );
});

test('the gate code is the first line and a contractor mark is kept', () => {
  const note = worksheetJobNote(
    { scopeLines: ['Rail'], customerType: 'contractor', notes: ['Dogs in the back'] },
    '4455',
  );
  assert.match(note, /^Gate code: 4455\nScope: Rail/);
  assert.match(note, /Marked Contractor on the worksheet/);
  assert.match(note, /Dogs in the back/);
});
