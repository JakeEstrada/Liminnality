import { describe, expect, it } from 'vitest';
import { customerDetailChanges, findCustomerMatches, isCompleteEmail } from './customerChanges';

const saved = {
  _id: 'c1',
  name: 'Celso Montillo',
  primaryPhone: '(714)391-1828',
  primaryEmail: 'celso.montillo@aol.com',
  address: { street: '100 Old St', city: 'Orange', state: 'CA', zip: '92867' },
};

describe('customerDetailChanges', () => {
  it('lists nothing when the entered details match the saved customer', () => {
    expect(
      customerDetailChanges(saved, {
        customerPhone: '714-391-1828',
        customerEmail: 'Celso.Montillo@aol.com',
        customerAddress: { street: '100 old st', city: 'Orange', state: '', zip: '' },
      }),
    ).toEqual([]);
  });

  it('lists each saved detail the worksheet would change', () => {
    const changes = customerDetailChanges(saved, {
      customerPhone: '(714)341-1828',
      customerEmail: '',
      customerAddress: { street: '4632 E Bradford', city: 'Orange', state: '', zip: '' },
    });
    expect(changes.map((change) => change.key)).toEqual(['primaryPhone', 'address']);
    expect(changes[0]).toMatchObject({ from: '(714)391-1828', to: '(714)341-1828' });
    expect(changes[1].value).toEqual({ street: '4632 E Bradford', city: 'Orange', state: 'CA', zip: '92867' });
  });

  it('lists a different gate code and leaves a blank one out', () => {
    const changes = customerDetailChanges(
      { ...saved, gateCode: '9999' },
      { gateCode: '4455', customerPhone: '714-391-1828', customerEmail: 'celso.montillo@aol.com' },
    );
    expect(changes).toEqual([{ key: 'gateCode', label: 'Gate code', from: '9999', to: '4455', value: '4455' }]);
    expect(customerDetailChanges(saved, { gateCode: '4455' })).toEqual([]);
  });
});

describe('findCustomerMatches', () => {
  it('finds a saved customer by the suggested email ending', () => {
    const matches = findCustomerMatches([saved], { customerEmail: 'celso.montillo@aol' }, 'celso.montillo@aol.com');
    expect(matches[0].customer._id).toBe('c1');
    expect(matches[0].reasons).toEqual(['email']);
  });
});

describe('isCompleteEmail', () => {
  it('rejects an email without its ending', () => {
    expect(isCompleteEmail('celso.montillo@aol')).toBe(false);
    expect(isCompleteEmail('celso.montillo@aol.com')).toBe(true);
  });
});
