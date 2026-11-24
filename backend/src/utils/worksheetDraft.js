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

const SHOP_PHONES = new Set(['9514911137']);
const SHOP_EMAILS = new Set(['mystairguy@gmail.com']);
const SHOP_NAMES = /^(joe\s+toombs|san\s+clemente\s+wood\s*working)$/i;

const EMAIL_DOMAIN_FIXES = {
  aol: 'aol.com',
  gmail: 'gmail.com',
  yahoo: 'yahoo.com',
  hotmail: 'hotmail.com',
  outlook: 'outlook.com',
  icloud: 'icloud.com',
  me: 'me.com',
  msn: 'msn.com',
  live: 'live.com',
  cox: 'cox.net',
  att: 'att.net',
  sbcglobal: 'sbcglobal.net',
  verizon: 'verizon.net',
  comcast: 'comcast.net',
};

const PAGE_TURNS = {
  upright: 0,
  turn_clockwise: 90,
  turn_counterclockwise: -90,
  upside_down: 180,
};

const FORM_FIELDS = [
  'customerName',
  'customerPhone',
  'customerEmail',
  'street',
  'city',
  'state',
  'zip',
  'valueEstimated',
];

function clip(value, max) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function fieldText(field) {
  if (field && typeof field === 'object') return clip(field.text, 200);
  return clip(field, 200);
}

function fieldReason(field) {
  if (!field || typeof field !== 'object' || !field.unclear) return '';
  return clip(field.reason, 160) || 'Hard to read on the worksheet';
}

function titleFromFilename(filename) {
  const base = clip(String(filename || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), 180);
  const marked = /worksheet\s+(.+)$/i.exec(base);
  const token = clip(marked ? marked[1] : '', 80);
  if (token && token.length >= 2 && !/^(pdf|scan|image|new)$/i.test(token)) return token;
  return '';
}

function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function cleanPhone(value) {
  const raw = clip(value, 40);
  const digits = phoneDigits(raw);
  if (!digits || SHOP_PHONES.has(digits)) return { value: '', problem: '' };
  if (digits.length === 10) return { value: digits, problem: '' };
  return { value: raw, problem: `Phone has ${digits.length} digits` };
}

function isCompleteEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
}

function cleanEmail(value) {
  const email = clip(value, 160).toLowerCase().replace(/\s+/g, '');
  if (!email || SHOP_EMAILS.has(email) || /@sanclementewoodworking\.com$/.test(email)) {
    return { value: '', problem: '', suggestion: '' };
  }
  if (isCompleteEmail(email)) return { value: email, problem: '', suggestion: '' };
  const [local, domain = ''] = email.split('@');
  const fix = EMAIL_DOMAIN_FIXES[domain.replace(/\.$/, '')];
  const suggestion = local && fix ? `${local}@${fix}` : '';
  return { value: email, problem: 'Email looks incomplete', suggestion };
}

function moneyValue(value) {
  if (value == null || value === '') return '';
  const cleaned = String(value)
    .replace(/[$,\s]/g, '')
    .replace(/\D+$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return '';
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100000000) return '';
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function cleanState(value) {
  const state = clip(value, 32);
  return /^[a-z]{2}$/i.test(state) ? state.toUpperCase() : state;
}

function nameCase(value) {
  return clip(value, 120).replace(/\b([a-z])([a-z'’-]*)/g, (_m, first, rest) => first.toUpperCase() + rest);
}

function sentenceCase(value) {
  const text = clip(value, 200);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function streetOnly(street, city) {
  const value = clip(street, 160);
  const town = clip(city, 80);
  if (!town) return value;
  const suffix = new RegExp(`[,\\s]+${town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  return value.replace(suffix, '').trim();
}

function suggestTitle({ street, scopeTitle, customerName, filename }) {
  const scope = sentenceCase(clip(scopeTitle, 60).replace(/[.]+$/, ''));
  const place = clip(street, 60) || clip(customerName, 60) || titleFromFilename(filename);
  if (place && scope) return clip(`${place} · ${scope}`, 90);
  return place || scope;
}

function materialLine(row) {
  const item = clip(row?.item, 40);
  if (!item) return '';
  const parts = [row?.wood, row?.finish, row?.quantity ? `qty ${clip(row.quantity, 20)}` : '', row?.note]
    .map((part) => clip(part, 80))
    .filter(Boolean);
  return parts.length ? `${item}: ${parts.join(', ')}` : '';
}

function contactLine(contact) {
  const parts = [contact?.name, contact?.phone, contact?.email, contact?.note]
    .map((part) => clip(part, 80))
    .filter(Boolean);
  return parts.join(' · ');
}

function normalizedForCompare(field, value) {
  const text = String(value || '').toLowerCase();
  if (field === 'customerPhone') return phoneDigits(text);
  if (field === 'valueEstimated') return moneyValue(text);
  if (field === 'customerEmail') return text.replace(/\s+/g, '');
  return text.replace(/[^a-z0-9]+/g, '');
}

function draftFields(reading, filename) {
  const body = reading && typeof reading === 'object' ? reading : {};
  const verify = {};
  const suggestions = {};

  const flag = (field, reason) => {
    if (reason && !verify[field]) verify[field] = reason;
  };

  let customerName = nameCase(fieldText(body.customerName));
  if (SHOP_NAMES.test(customerName)) customerName = '';
  flag('customerName', customerName ? fieldReason(body.customerName) : '');

  const phone = cleanPhone(fieldText(body.customerPhone));
  flag('customerPhone', phone.value ? fieldReason(body.customerPhone) || phone.problem : '');

  const email = cleanEmail(fieldText(body.customerEmail));
  flag('customerEmail', email.value ? email.problem || fieldReason(body.customerEmail) : '');
  if (email.suggestion) suggestions.customerEmail = email.suggestion;

  const city = fieldText(body.city);
  const street = streetOnly(fieldText(body.street), city);
  flag('street', street ? fieldReason(body.street) : '');
  flag('city', city ? fieldReason(body.city) : '');

  const state = cleanState(fieldText(body.state));
  flag('state', state ? fieldReason(body.state) : '');
  const zip = fieldText(body.zip).replace(/[^\d-]/g, '').slice(0, 10);
  flag('zip', zip ? fieldReason(body.zip) : '');

  const totalText = fieldText(body.total);
  const valueEstimated = moneyValue(totalText);
  if (valueEstimated) flag('valueEstimated', fieldReason(body.total));
  else if (totalText) flag('valueEstimated', `Total written as "${totalText}"`);

  const ref = fieldText(body.ref);
  const source = ref ? 'referral' : 'other';

  return {
    fields: {
      customerName,
      customerPhone: phone.value,
      customerEmail: email.value,
      street,
      city,
      state,
      zip,
      valueEstimated,
      source,
      referralCompany: clip(ref, 120),
    },
    verify,
    suggestions,
    filename,
  };
}

function materialRows(body) {
  return (Array.isArray(body?.materials) ? body.materials : [])
    .map((row) => ({
      item: clip(row?.item, 40),
      wood: /^[x✓✔]$/i.test(clip(row?.wood, 40)) ? '' : clip(row?.wood, 40),
      finish: clip(row?.finish, 40),
      quantity: clip(row?.quantity, 20),
      note: clip(row?.note, 80),
    }))
    .filter((row) => row.item && (row.wood || row.finish || row.quantity || row.note))
    .slice(0, 16);
}

function contactRows(body, { customerPhone, customerName }) {
  const mainPhone = phoneDigits(customerPhone);
  const mainFirst = clip(customerName, 120).split(' ')[0].toLowerCase();
  return (Array.isArray(body?.otherContacts) ? body.otherContacts : [])
    .map((contact) => {
      let phone = clip(contact?.phone, 40);
      let note = clip(contact?.note, 120);
      const label = /^([a-z]{1,4}\.?)\s+(?=\d)/i.exec(phone);
      if (label) {
        phone = phone.slice(label[0].length);
        if (!note) note = label[1];
      }
      return {
        name: nameCase(clip(contact?.name, 80)),
        phone,
        email: clip(contact?.email, 120).toLowerCase(),
        note,
        verify: contact?.unclear ? clip(contact?.reason, 160) || 'Hard to read on the worksheet' : '',
      };
    })
    .filter((contact) => contact.name || contact.phone || contact.email)
    .filter((contact) => !SHOP_PHONES.has(phoneDigits(contact.phone)) && !SHOP_EMAILS.has(contact.email))
    .filter((contact) => {
      const digits = phoneDigits(contact.phone);
      if (mainPhone && digits === mainPhone) return false;
      const sameName = mainFirst && contact.name.toLowerCase() === mainFirst;
      return !(sameName && !digits && !contact.email);
    })
    .slice(0, 6);
}

function describeWorksheet(reading, { valueEstimated, ref, materials, otherContacts }) {
  const body = reading && typeof reading === 'object' ? reading : {};
  const scopeLines = (Array.isArray(body.scopeLines) ? body.scopeLines : [])
    .map((line) => sentenceCase(line))
    .filter(Boolean)
    .slice(0, 12);
  const checked = (Array.isArray(body.options) ? body.options : [])
    .filter((option) => option?.checked && clip(option.label, 60))
    .map((option) => clip(option.label, 60))
    .filter((label) => !/^(customer|contractor|accepted)$/i.test(label));
  const notes = (Array.isArray(body.notes) ? body.notes : [])
    .map((note) => clip(note, 200))
    .filter((note) => note && !/^sketch\b/i.test(note) && !/\bchecked$/i.test(note))
    .slice(0, 8);
  const worksheetDate = fieldText(body.worksheetDate);
  const customerType = ['customer', 'contractor'].includes(body.customerType) ? body.customerType : '';
  const materialLines = materials.map(materialLine).filter(Boolean);

  const lines = [];
  if (scopeLines.length) lines.push(`Scope: ${scopeLines.join(' ')}`);
  if (checked.length) lines.push(`Options: ${checked.join(', ')}`);
  materialLines.forEach((line) => lines.push(line));
  if (valueEstimated) lines.push(`Worksheet total: $${Number(valueEstimated).toLocaleString('en-US')}`);
  if (ref) lines.push(`Ref: ${ref}`);
  otherContacts.forEach((contact) => lines.push(`Other contact: ${contactLine(contact)}`));
  if (worksheetDate) lines.push(`Worksheet date: ${worksheetDate}`);
  if (customerType === 'contractor') lines.push('Marked Contractor on the worksheet');

  return {
    description: lines.join('\n').slice(0, 2000),
    review: {
      scopeLines,
      options: checked,
      materials: materialLines,
      otherContacts,
      referral: ref,
      worksheetDate,
      customerType,
      notes,
    },
  };
}

function displayValue(field, value) {
  if (field === 'customerPhone') {
    const digits = phoneDigits(value);
    return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : value;
  }
  if (field === 'valueEstimated') return `$${Number(value).toLocaleString('en-US')}`;
  return value;
}

function compareReadings(primaryFields, checkFields, verify) {
  if (!checkFields) return;
  for (const field of FORM_FIELDS) {
    const first = primaryFields[field];
    const second = checkFields[field];
    if (!first && !second) continue;
    if (normalizedForCompare(field, first) === normalizedForCompare(field, second)) continue;
    if (verify[field]) continue;
    if (!first) continue;
    verify[field] = second
      ? `Could also read as "${displayValue(field, second)}"`
      : 'Only one of two reads found this';
  }
}

function compareMaterials(primaryRows, checkRows) {
  if (!checkRows) return [];
  const byItem = new Map(checkRows.map((row) => [row.item.toLowerCase(), row]));
  const notes = [];
  for (const row of primaryRows) {
    const other = byItem.get(row.item.toLowerCase());
    if (!other || !row.quantity || !other.quantity) continue;
    if (row.quantity.replace(/\D/g, '') === other.quantity.replace(/\D/g, '')) continue;
    notes.push(`${row.item} quantity could be ${row.quantity} or ${other.quantity}`);
  }
  return notes;
}

function compareContacts(primaryContacts, checkContacts) {
  if (!checkContacts) return;
  for (const contact of primaryContacts) {
    if (contact.verify || !contact.phone) continue;
    const other = checkContacts.find(
      (row) => row.name && contact.name && row.name.toLowerCase() === contact.name.toLowerCase(),
    );
    if (!other?.phone) continue;
    if (phoneDigits(other.phone) !== phoneDigits(contact.phone)) {
      contact.verify = `Phone could also read as ${other.phone}`;
    }
  }
}

/**
 * Turns one or two vision reads of a worksheet into an editable job draft.
 * The second read only adds Verify flags where the two disagree.
 */
function buildWorksheetResult(primary, check = null, filename = '') {
  const first = draftFields(primary, filename);
  const second = check ? draftFields(check, filename) : null;
  compareReadings(first.fields, second?.fields, first.verify);

  const materials = materialRows(primary);
  const otherContacts = contactRows(primary, first.fields);
  compareContacts(otherContacts, check ? contactRows(check, second.fields) : null);
  const quantityNotes = compareMaterials(materials, check ? materialRows(check) : null);
  if (quantityNotes.length) first.verify.description = quantityNotes.join('. ');

  const { description, review } = describeWorksheet(primary, {
    valueEstimated: first.fields.valueEstimated,
    ref: first.fields.referralCompany,
    materials,
    otherContacts,
  });
  const title = suggestTitle({
    street: first.fields.street,
    scopeTitle: primary?.scopeTitle,
    customerName: first.fields.customerName,
    filename,
  });
  const turn = PAGE_TURNS[primary?.pageTurn] || 0;

  return {
    draft: {
      title,
      description,
      ...first.fields,
      source: SOURCES.has(first.fields.source) ? first.fields.source : 'other',
    },
    verify: first.verify,
    suggestions: first.suggestions,
    review,
    pageTurn: turn,
    isScwwWorksheet: Boolean(primary?.isScwwWorksheet),
  };
}

module.exports = {
  buildWorksheetResult,
  cleanEmail,
  moneyValue,
  suggestTitle,
  titleFromFilename,
};
