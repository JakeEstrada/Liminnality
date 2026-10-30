function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function collectCustomerEmails(customer) {
  const rows = [
    customer?.primaryEmail,
    ...(Array.isArray(customer?.emails) ? customer.emails : []),
    ...(Array.isArray(customer?.contactEmails) ? customer.contactEmails.map((row) => row?.value) : []),
  ];
  return new Set(rows.map(normalizeEmail).filter(Boolean));
}

/**
 * Job creation copies the customer email onto jobContact. When that address is
 * later removed from the customer, the job copy should follow the customer.
 * An email that was never on the customer is left alone.
 */
function replacementForRemovedJobEmail(jobEmail, previousCustomer, nextCustomer) {
  const current = normalizeEmail(jobEmail);
  if (!current) return null;
  const previous = collectCustomerEmails(previousCustomer);
  const next = collectCustomerEmails(nextCustomer);
  if (!previous.has(current) || next.has(current)) return null;
  return normalizeEmail(nextCustomer?.primaryEmail);
}

module.exports = {
  collectCustomerEmails,
  normalizeEmail,
  replacementForRemovedJobEmail,
};
