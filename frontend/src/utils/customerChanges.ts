import { formatPhoneForDisplay, nanpDigitsOnly } from './phoneFormat';

type Address = { street?: string; city?: string; state?: string; zip?: string };

type SavedCustomer = {
  _id: string;
  name?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  address?: Address | null;
};

type EnteredDetails = {
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: Address;
};

export type CustomerChange = {
  key: 'primaryPhone' | 'primaryEmail' | 'address';
  label: string;
  from: string;
  to: string;
  value: string | Address;
};

export function isCompleteEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(value || '').trim());
}

function same(a: unknown, b: unknown) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export function formatAddress(address: Address | null | undefined) {
  if (!address) return '';
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [address.street, cityLine].filter(Boolean).join(', ');
}

/** Saved-customer fields the entered details would overwrite or fill in. */
export function customerDetailChanges(saved: SavedCustomer | null | undefined, entered: EnteredDetails) {
  if (!saved) return [];
  const changes: CustomerChange[] = [];

  const phone = nanpDigitsOnly(entered.customerPhone);
  if (phone && phone !== nanpDigitsOnly(saved.primaryPhone)) {
    changes.push({
      key: 'primaryPhone',
      label: 'Phone',
      from: formatPhoneForDisplay(saved.primaryPhone),
      to: formatPhoneForDisplay(entered.customerPhone),
      value: String(entered.customerPhone || '').trim(),
    });
  }

  const email = String(entered.customerEmail || '').trim().toLowerCase();
  if (email && !same(email, saved.primaryEmail)) {
    changes.push({ key: 'primaryEmail', label: 'Email', from: saved.primaryEmail || '', to: email, value: email });
  }

  const next = entered.customerAddress || {};
  const prev = saved.address || {};
  const parts = ['street', 'city', 'state', 'zip'] as const;
  const differs = parts.some((part) => String(next[part] || '').trim() && !same(next[part], prev[part]));
  if (differs) {
    const merged: Address = {};
    for (const part of parts) merged[part] = String(next[part] || '').trim() || String(prev[part] || '').trim();
    changes.push({
      key: 'address',
      label: 'Address',
      from: formatAddress(prev),
      to: formatAddress(merged),
      value: merged,
    });
  }

  return changes;
}

/** Saved customers that look like the person on the worksheet. */
export function findCustomerMatches(
  customers: SavedCustomer[],
  entered: EnteredDetails,
  emailSuggestion = '',
) {
  const email = String(entered.customerEmail || '').trim().toLowerCase();
  const emails = [email, String(emailSuggestion || '').trim().toLowerCase()].filter(Boolean);
  const phone = nanpDigitsOnly(entered.customerPhone);
  const name = String(entered.customerName || '').trim().toLowerCase();
  const street = String(entered.customerAddress?.street || '').trim().toLowerCase();

  return (customers || [])
    .map((customer) => {
      const reasons: string[] = [];
      if (emails.length && emails.includes(String(customer.primaryEmail || '').trim().toLowerCase())) reasons.push('email');
      if (phone.length === 10 && nanpDigitsOnly(customer.primaryPhone) === phone) reasons.push('phone');
      if (name && String(customer.name || '').trim().toLowerCase() === name) reasons.push('name');
      if (street && String(customer.address?.street || '').trim().toLowerCase() === street) reasons.push('address');
      return { customer, reasons };
    })
    .filter((row) => row.reasons.length)
    .sort((a, b) => b.reasons.length - a.reasons.length)
    .slice(0, 3);
}
