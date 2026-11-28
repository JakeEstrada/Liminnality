/**
 * Turns one copied shop into demo data.
 * Phone numbers keep their area code and last four digits, with 555 in the middle.
 * Street text changes. Coordinates and prices are left alone.
 */

const FIRST = [
  'Avery', 'Blake', 'Casey', 'Drew', 'Elliot', 'Finley', 'Gray', 'Harper',
  'Indigo', 'Jules', 'Kendall', 'Logan', 'Morgan', 'Noah', 'Parker', 'Quinn',
  'Reese', 'Rowan', 'Sawyer', 'Shay', 'Taylor', 'Winter',
];
const LAST = [
  'Adler', 'Beck', 'Cole', 'Diaz', 'Ellis', 'Frost', 'Garcia', 'Hahn',
  'Ibarra', 'Jin', 'Keller', 'Lane', 'Moss', 'Ng', 'Ortiz', 'Perez',
  'Quill', 'Reed', 'Shah', 'Tran', 'Voss', 'Walsh',
];
const COMPANIES = [
  'Northwind Homes', 'Brightline Builders', 'Cedar Rail Co', 'Harbor Glass Co',
  'Summit Stair Co', 'Meadow Joinery', 'Brookline Interiors', 'Larkspur Millworks',
  'Quarry Ridge Homes', 'Fern Street Studio', 'Cinder Post Co', 'Willow Landing',
];
const STREET_NAMES = ['Harbor', 'Cedar', 'Willow', 'Maple', 'Summit', 'Brook', 'Lark', 'Fern', 'Cinder', 'Quarry', 'Meadow', 'Birch'];
const STREET_TYPES = ['Lane', 'Avenue', 'Street', 'Drive', 'Court', 'Way'];

const STOP = new Set([
  'will', 'bill', 'art', 'ray', 'guy', 'don', 'pat', 'van', 'wood', 'iron', 'oak', 'pine',
  'post', 'rail', 'stair', 'stairs', 'glass', 'white', 'black', 'brown', 'green', 'stone',
  'rock', 'field', 'park', 'view', 'beach', 'mesa', 'canyon', 'point', 'north', 'south',
  'east', 'west', 'san', 'los', 'las', 'del', 'high', 'long', 'lane', 'road', 'street',
  'court', 'place', 'drive', 'way', 'trail', 'circle', 'avenue', 'home', 'homes', 'city',
  'county', 'custom', 'build', 'builds', 'shop', 'crew', 'team', 'demo', 'copy', 'main',
  'side', 'left', 'right', 'front', 'back', 'new', 'old', 'top', 'red', 'blue', 'gold',
  'gray', 'grey', 'hill', 'ridge', 'creek', 'lake', 'river', 'bay', 'cove', 'port',
  'harbor', 'pacific', 'mission', 'avenida', 'calle', 'via', 'camino', 'rancho', 'villa',
  'vista', 'monte', 'santa', 'santo', 'the', 'and',
]);

const BUSINESS = /\b(llc|inc|corp|company|co\.?|homes|construction|builders|woodworking|supply|services|group|associates)\b/i;

const PRESERVE_KEYS = new Set([
  '_id', 'id', 'password', 's3Key', 'path', 'embedding', 'twilioSid', 'filename',
  'uid', 'pin', 'lat', 'lng', 'latitude', 'longitude',
  'amount', 'unitPrice', 'total', 'valueEstimated', 'valueContracted',
  'paidAmount', 'percentage', 'quantity', 'depositRequired', 'depositReceived',
  'contractTotal', 'ratePerHour', 'price', 'balance', 'size',
  'stage', 'status', 'role', 'kind', 'mimetype', 'fileType', 'color',
  'source', 'billing', 'amountType', 'dueType', 'priority', 'direction',
  'smsDirection', 'calendarStatus', 'type', 'slug', 'website',
  'shiftIn', 'shiftOut', 'breakMinutes', 'onRoster', 'isActive', 'isPending',
  'city', 'state', 'zip', 'zipCode',
  'refreshToken', 'accessToken', 'accessTokenExpiresAt', 'itemId',
]);

const PHONE_RE = /(?<!\d)(\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tenDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

function isFormattedPhone(raw) {
  return /[()+\-.]|\s/.test(String(raw || '')) && Boolean(tenDigits(raw));
}

const NUMBERED_STREET_RE = /(?<![\d.])\d{1,6}\s+(?:[A-Za-z0-9.'’#-]+\s+){0,3}(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Circle|Cir|Way|Place|Pl|Boulevard|Blvd|Trail|Trl|Terrace|Ter|Parkway|Pkwy)\b\.?|(?<![\d.])\d{1,6}\s+(?:Avenida|Calle|Camino|Paseo|Via)\s+[A-Za-z0-9.'’#-]+(?:\s+[A-Za-z0-9.'’#-]+){0,3}/gi;
const NAMED_STREET_RE = /\b[A-Z][A-Za-z'’.-]{2,}(?:\s+[A-Z][A-Za-z'’.-]{2,}){0,2}\s+(?:Street|Avenue|Drive|Road|Lane|Court|Circle|Boulevard|Parkway|Cir|Ct|Ave|Rd|Ln|Dr|Way|Pl)\b/g;

function extractStreetPhrases(text) {
  const source = String(text || '');
  const numbered = [...source.matchAll(NUMBERED_STREET_RE)].map((match) => match[0].replace(/\.$/, '').trim());
  const named = [...source.matchAll(NAMED_STREET_RE)].map((match) => match[0].trim());
  return [...numbered, ...named];
}

function findPhoneMatches(text) {
  const matches = [];
  const source = String(text || '');
  for (const match of source.matchAll(PHONE_RE)) {
    const ten = tenDigits(match[0]);
    if (!ten) continue;
    matches.push({ raw: match[0], ten, formatted: isFormattedPhone(match[0]) });
  }
  return matches;
}

function maskTenDigits(ten) {
  return `${ten.slice(0, 3)}555${ten.slice(6)}`;
}

/**
 * Keeps the area code and the last four digits. The middle becomes 555.
 * Later duplicates of that same result get a different last four.
 */
function assignPhoneMap(tens) {
  const map = new Map();
  const used = new Set();
  let collisions = 0;
  for (const ten of [...tens].filter((value) => /^\d{10}$/.test(value)).sort()) {
    const area = ten.slice(0, 3);
    const last4 = ten.slice(6);
    let candidate = `${area}555${last4}`;
    if (used.has(candidate)) {
      collisions += 1;
      let n = Number(last4);
      for (let i = 0; i < 10000; i += 1) {
        n = (n + 1) % 10000;
        candidate = `${area}555${String(n).padStart(4, '0')}`;
        if (!used.has(candidate)) break;
      }
    }
    used.add(candidate);
    map.set(ten, candidate);
  }
  map.collisions = collisions;
  return map;
}

function formatLike(original, maskedTen) {
  const area = maskedTen.slice(0, 3);
  const last4 = maskedTen.slice(6);
  const body = `${area}555${last4}`;
  const raw = String(original || '');
  const digits = raw.replace(/\D/g, '');
  const plus = raw.trim().startsWith('+');
  const country = plus || (digits.length === 11 && digits.startsWith('1'));
  if (/\(\d{3}\)/.test(raw)) {
    const spaced = /\(\d{3}\)\s+\d/.test(raw);
    const local = spaced ? `(${area}) 555-${last4}` : `(${area})555-${last4}`;
    if (plus) return `+1 ${local}`;
    if (country && /^1[\s.-]/.test(raw.trim())) return raw.trim().startsWith('1-') ? `1-${area}-555-${last4}` : `1 ${local}`;
    return local;
  }
  if (raw.includes('.')) {
    const local = `${area}.555.${last4}`;
    if (plus) return `+1.${local}`;
    if (country) return `1.${local}`;
    return local;
  }
  if (raw.includes('-') || raw.includes(' ')) {
    const local = `${area}-555-${last4}`;
    if (plus) return `+1 ${local}`;
    if (country) return `1-${local}`;
    return local;
  }
  if (plus) return `+1${body}`;
  if (country) return `1${body}`;
  return body;
}

function replacePhones(text, phoneMap) {
  if (!text || !phoneMap || phoneMap.size === 0) return text;
  return String(text).replace(PHONE_RE, (match) => {
    const ten = tenDigits(match);
    const masked = ten && phoneMap.get(ten);
    if (!masked) return match;
    return formatLike(match, masked);
  });
}

function demoStreet(original) {
  const n = hashString(String(original || '').toLowerCase().replace(/\s+/g, ' ').trim());
  const num = 100 + (n % 800);
  const name = STREET_NAMES[n % STREET_NAMES.length];
  const type = STREET_TYPES[Math.floor(n / 7) % STREET_TYPES.length];
  return `${num} ${name} ${type}`;
}

function streetRemainder(street) {
  const rest = String(street || '').trim().replace(/^\d+[A-Za-z]?\s+/, '');
  if (rest.length < 6 || rest === street) return '';
  if (STOP.has(rest.toLowerCase())) return '';
  return rest;
}

const USERNAMES = new Set(['scww', 'admin', 'office', 'demo']);

function isPersonName(name) {
  if (BUSINESS.test(name)) return false;
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length === 1) {
    const token = parts[0];
    if (!/^[A-Za-z][A-Za-z'’-]+$/.test(token)) return false;
    if (token.length < 3 || token.length > 20) return false;
    if (STOP.has(token.toLowerCase()) || USERNAMES.has(token.toLowerCase())) return false;
    return true;
  }
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((part) => /^[A-Za-z][A-Za-z'’.-]*$/.test(part));
}

function personTokens(name) {
  if (!isPersonName(name)) return [];
  return String(name).trim().split(/\s+/).filter((part) => {
    const token = part.replace(/[^A-Za-z'’-]/g, '');
    return token.length >= 4 && !STOP.has(token.toLowerCase());
  });
}

function takeUnique(seed, used, label) {
  let n = hashString(seed.toLowerCase());
  const list = label === 'company' ? COMPANIES : null;
  for (let i = 0; i < 500; i += 1) {
    const name = list
      ? list[n % list.length]
      : `${FIRST[n % FIRST.length]} ${LAST[Math.floor(n / FIRST.length) % LAST.length]}`;
    const key = name.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return name;
    }
    n += 1;
  }
  const extra = `Demo ${label === 'company' ? 'Company' : 'Person'} ${used.size + 1}`;
  used.add(extra.toLowerCase());
  return extra;
}

function replacePhrases(text, pairs) {
  if (!text || !pairs.length) return String(text || '');
  const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length);
  const pattern = sorted.map(([from]) => escapeRegExp(from)).join('|');
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${pattern})(?![A-Za-z0-9@+])`, 'gi');
  return String(text).replace(re, (match) => {
    const found = sorted.find(([from]) => from.toLowerCase() === match.toLowerCase());
    return found ? found[1] : match;
  });
}

function buildDemoContext({ names = [], phones = [], streets = [], emails = [], protectedEmails = [] } = {}) {
  const protectedSet = new Set(protectedEmails.map((email) => String(email || '').toLowerCase()).filter(Boolean));
  const tens = new Set();
  for (const phone of phones) {
    const ten = tenDigits(phone);
    if (ten) tens.add(ten);
  }
  const phoneMap = assignPhoneMap([...tens]);
  const usedNames = new Set();
  const fullPairs = [];
  const tokenTargets = new Map();
  const employeeKeys = new Map();

  const byLower = new Map();
  for (const name of names) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean || clean.length < 2) continue;
    const prev = byLower.get(clean.toLowerCase());
    if (!prev || (clean !== clean.toLowerCase() && prev === prev.toLowerCase())) byLower.set(clean.toLowerCase(), clean);
  }
  const distinctNames = [...byLower.values()].sort((a, b) => b.length - a.length);
  for (const name of distinctNames) {
    const demo = isPersonName(name) ? takeUnique(name, usedNames, 'person') : takeUnique(name, usedNames, 'company');
    fullPairs.push([name, demo]);
    employeeKeys.set(employeeKey(name), employeeKey(demo));
    if (isPersonName(name)) {
      const parts = demo.split(/\s+/);
      const tokens = personTokens(name);
      tokens.forEach((token, index) => {
        const target = parts[Math.min(index, parts.length - 1)];
        if (!tokenTargets.has(token.toLowerCase())) tokenTargets.set(token.toLowerCase(), target);
      });
    }
  }
  for (const [token, target] of tokenTargets) {
    fullPairs.push([token, target]);
  }

  const personNames = new Set(distinctNames.filter((name) => isPersonName(name)).map((name) => name.toLowerCase()));
  const streetPairs = [];
  const seenStreets = new Set();
  for (const street of streets) {
    const clean = String(street || '').trim();
    if (clean.length < 4 || seenStreets.has(clean.toLowerCase()) || personNames.has(clean.toLowerCase())) continue;
    seenStreets.add(clean.toLowerCase());
    streetPairs.push([clean, demoStreet(clean)]);
    const rest = streetRemainder(clean);
    if (rest && !seenStreets.has(rest.toLowerCase())) {
      seenStreets.add(rest.toLowerCase());
      const named = demoStreet(clean).replace(/^\d+\s+/, '');
      streetPairs.push([rest, named]);
    }
  }

  const emailPairs = [];
  const usedEmails = new Set();
  for (const email of emails) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean.includes('@') || protectedSet.has(clean)) continue;
    let next = `demo.${hashString(clean).toString(36)}@example.com`;
    while (usedEmails.has(next) || protectedSet.has(next)) {
      next = `demo.${hashString(next).toString(36)}@example.com`;
    }
    usedEmails.add(next);
    emailPairs.push([clean, next]);
  }

  const shopPairs = [
    ['San Clemente Wood Working', 'Harbor & Pine Demo'],
    ['San Clemente Woodworking', 'Harbor & Pine Demo'],
  ];

  return {
    phoneMap,
    phoneCollisions: phoneMap.collisions || 0,
    employeeKeys,
    namePairs: fullPairs,
    streetPairs,
    emailPairs,
    shopPairs,
    protectedEmails: protectedSet,
  };
}

function replaceEmails(text, emailPairs) {
  if (!emailPairs.length) return text;
  let next = String(text);
  for (const [from, to] of emailPairs) {
    next = next.replace(new RegExp(escapeRegExp(from), 'gi'), to);
  }
  return next;
}

function scrubText(text, ctx) {
  if (text == null) return text;
  let next = String(text);
  next = replaceEmails(next, ctx.emailPairs || []);
  next = replacePhrases(next, ctx.streetPairs || []);
  next = replacePhrases(next, ctx.namePairs || []);
  next = replacePhrases(next, ctx.shopPairs || []);
  next = next.replace(/\bSCWW\b(?!\+copy)/gi, 'Demo');
  next = replacePhones(next, ctx.phoneMap);
  return next;
}

function isObjectId(value) {
  return Boolean(value && value._bsontype === 'ObjectId');
}

function rewriteAddressObject(address, ctx) {
  const next = { ...address };
  const street = String(address.street || '').trim();
  if (street) {
    const match = (ctx.streetPairs || []).find(([from]) => from.toLowerCase() === street.toLowerCase());
    next.street = match ? match[1] : demoStreet(street);
  }
  if (address.fullAddress) next.fullAddress = scrubText(address.fullAddress, ctx);
  if (address.sourceAddress) next.sourceAddress = scrubText(address.sourceAddress, ctx);
  return next;
}

function looksLikeAddress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.prototype.hasOwnProperty.call(value, 'street')
    || Object.prototype.hasOwnProperty.call(value, 'fullAddress');
}

function anonymizeValue(value, ctx, key = '', collection = '') {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date || isObjectId(value)) return value;
  if (Buffer.isBuffer(value)) return value;
  if (PRESERVE_KEYS.has(key)) return value;
  if (key === 'email' && collection === 'users' && ctx.protectedEmails && ctx.protectedEmails.has(String(value || '').trim().toLowerCase())) {
    return value;
  }
  if (key === 'name' && collection === 'tenants') return value;
  if (key === 'gateCode') return '';
  if (key === 'employeeKey' && ctx.employeeKeys && ctx.employeeKeys.has(String(value || '').trim().toLowerCase())) {
    return ctx.employeeKeys.get(String(value || '').trim().toLowerCase());
  }
  if (typeof value === 'string') {
    if (key === 'street' || (key === 'addressLine1' && (/\d/.test(value) || value.includes(',')))) {
      const clean = value.trim();
      if (!clean) return value;
      const match = (ctx.streetPairs || []).find(([from]) => from.toLowerCase() === clean.toLowerCase());
      return match ? match[1] : demoStreet(clean);
    }
    if (/phone|mobile/i.test(key)) {
      const digits = String(value).replace(/\D/g, '');
      const ten = tenDigits(value);
      const masked = ten && ctx.phoneMap.get(ten);
      if (masked && (digits.length === 10 || digits.length === 11) && !/[A-Za-z]{3,}/.test(value)) {
        return formatLike(value, masked);
      }
    }
    return scrubText(value, ctx);
  }
  if (Array.isArray(value)) return value.map((item) => anonymizeValue(item, ctx, key, collection));
  if (typeof value === 'object') {
    if (looksLikeAddress(value) && key !== 'geo') {
      const rewritten = rewriteAddressObject(value, ctx);
      const out = {};
      for (const [childKey, child] of Object.entries(rewritten)) {
        if (PRESERVE_KEYS.has(childKey) || childKey === 'street' || childKey === 'fullAddress') out[childKey] = rewritten[childKey];
        else out[childKey] = anonymizeValue(child, ctx, childKey, collection);
      }
      return out;
    }
    const out = {};
    for (const [childKey, child] of Object.entries(value)) {
      out[childKey] = anonymizeValue(child, ctx, childKey, collection);
    }
    return out;
  }
  return value;
}

function collectFromValue(value, bucket, key = '', collection = '') {
  if (value == null) return;
    if (typeof value === 'string') {
    if (PRESERVE_KEYS.has(key)) return;
    for (const street of extractStreetPhrases(value)) bucket.streets.push(street);
    if (key === 'email' && collection === 'users' && value.trim().toLowerCase() === 'scww+copy') {
      bucket.protectedEmails.push(value);
      return;
    }
    if (/phone|mobile/i.test(key)) bucket.phones.push(value);
    for (const match of findPhoneMatches(value)) {
      if (match.formatted || /phone|mobile/i.test(key)) bucket.phones.push(match.raw);
    }
    if (/^(name|displayName|customerName|createdByName|installer|installers|referralCompany|companyName|mailboxName|soldTo)$/.test(key)) {
      if (value.trim()) bucket.names.push(value.trim());
    }
    if (key === 'street' || key === 'addressLine1') {
      if (value.trim()) bucket.streets.push(value.trim());
    }
    if (key === 'fullAddress' || key === 'sourceAddress' || (key === 'location' && /\d/.test(value))) {
      const lead = value.split(',')[0].trim();
      if (lead.length >= 4) bucket.streets.push(lead);
    }
    if (/email/i.test(key) && value.includes('@')) bucket.emails.push(value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date || isObjectId(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectFromValue(item, bucket, key, collection));
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      collectFromValue(child, bucket, childKey, collection);
    }
  }
}

function employeeKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = {
  assignPhoneMap,
  anonymizeValue,
  buildDemoContext,
  collectFromValue,
  demoStreet,
  employeeKey,
  findPhoneMatches,
  formatLike,
  maskTenDigits,
  scrubText,
  tenDigits,
};
