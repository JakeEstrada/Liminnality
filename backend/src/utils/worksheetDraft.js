const SOURCES = new Set([
  'referral',
  'vehicle_advertisement',
  'yelp',
  'instagram',
  'facebook',
  'website',
  'repeat',
  'other',
]);

function clip(value, max) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function titleFromFilename(filename) {
  const base = clip(String(filename || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), 180);
  const marked = /worksheet\s+(.+)$/i.exec(base);
  const token = clip(marked ? marked[1] : '', 80);
  if (token && token.length >= 2 && !/^(pdf|scan|image|new)$/i.test(token)) return token;
  return '';
}

function cleanEmail(value) {
  const email = clip(value, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  if (/sanclementewoodworking\.com$/.test(email) || email === 'mystairguy@gmail.com') return '';
  return email;
}

function cleanPhone(value) {
  const raw = clip(value, 40);
  const digits = raw.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length < 10) return '';
  if (national.slice(0, 10) === '9514911137') return '';
  return national.slice(0, 10);
}

function cleanMoney(value) {
  if (value == null || value === '') return '';
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100000000) return '';
  const rounded = Math.round(numeric * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function cleanState(value) {
  const state = clip(value, 32);
  if (/^[a-z]{2}$/i.test(state)) return state.toUpperCase();
  return state;
}

function sanitizeWorksheetDraft(raw, filename = '') {
  const body = raw && typeof raw === 'object' ? raw : {};
  let source = clip(body.source, 40).toLowerCase().replace(/\s+/g, '_');
  if (source === 'vehicle' || source === 'truck' || source === 'van') source = 'vehicle_advertisement';
  if (source === 'repeat_customer') source = 'repeat';
  if (!SOURCES.has(source)) source = 'other';

  const referralCompany = clip(body.referralCompany || body.referredBy || '', 120);
  if (referralCompany && source === 'other') source = 'referral';

  const title = clip(body.title, 140) || titleFromFilename(filename);
  const customerName = clip(body.customerName, 120);

  return {
    title,
    customerName,
    customerPhone: cleanPhone(body.customerPhone),
    customerEmail: cleanEmail(body.customerEmail),
    street: clip(body.street, 160),
    city: clip(body.city, 80),
    state: cleanState(body.state),
    zip: clip(body.zip, 10).replace(/[^\d-]/g, ''),
    valueEstimated: cleanMoney(body.valueEstimated),
    source,
    referralCompany: source === 'referral' ? referralCompany : '',
    extraNote: clip(body.extraNote, 400),
  };
}

module.exports = {
  sanitizeWorksheetDraft,
  titleFromFilename,
};
