function resolveJobId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const prefixed = value.match(/^(?:job[-_])([a-f0-9]{24})$/i);
  if (prefixed) return prefixed[1];
  if (/^[a-f0-9]{24}$/i.test(value)) return value;
  const embedded = value.match(/[a-f0-9]{24}/i);
  return embedded ? embedded[0] : '';
}

module.exports = { resolveJobId };
