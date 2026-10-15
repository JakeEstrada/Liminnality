/* eslint-disable no-console */
/**
 * Fill a cloned demo tenant with recent-looking office activity:
 * team audit log, website traffic, SMS threads, bills, vendors, RFID clock-ins,
 * and a current weekly work log.
 *
 * Usage:
 *   node src/scripts/seedDemoShowcase.js --slug scww-demo-real4
 */
require('dotenv').config();
const mongoose = require('mongoose');

const Tenant = require('../models/Tenant');
const WebsiteContent = require('../models/WebsiteContent');

const MARK = '[demo seed]';
const SMS_SID_PREFIX = 'DEMOSEED-';
const SESSION_PREFIX = 'demoseed-';
const RFID_SOURCE = 'demo-seed';
const AUDIT_ISP = 'Demo seed';
const SHOP_FROM = '+19497750214';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Pacific Time. 2026 DST: Mar 8 – Nov 1. */
function atPacific(y, m, d, h = 9, min = 0, sec = 0) {
  const dst = m > 3 && m < 11 || (m === 3 && d >= 8) || (m === 11 && d === 1);
  const off = dst ? '-07:00' : '-08:00';
  return new Date(`${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:${pad(sec)}${off}`);
}

function ymdParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

function weekdayPacific(date) {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  }).format(date);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[short] ?? 0;
}

function eachDay(from, to) {
  const days = [];
  const cursor = new Date(from);
  cursor.setUTCHours(12, 0, 0, 0);
  while (cursor <= to) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function jitter(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function e164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return '';
}

function oid() {
  return new mongoose.Types.ObjectId();
}

async function listTenants() {
  const rows = await Tenant.find({}, { name: 1, slug: 1, isActive: 1 }).setOptions({ bypassTenant: true }).lean();
  return rows.map((t) => `- ${t.slug} (${t.name})${t.isActive === false ? ' [inactive]' : ''}`).join('\n');
}

async function resolveTenant(args) {
  const slug = String(args.slug || args.tenant || 'scww-demo-real4').trim().toLowerCase();
  const tenantId = String(args.tenantId || '').trim();
  if (tenantId) {
    const byId = await Tenant.findById(tenantId).setOptions({ bypassTenant: true });
    if (!byId) throw new Error(`Tenant not found for id ${tenantId}\n${await listTenants()}`);
    return byId;
  }
  const bySlug = await Tenant.findOne({ slug }).setOptions({ bypassTenant: true });
  if (!bySlug) throw new Error(`Tenant not found for slug "${slug}"\n${await listTenants()}`);
  return bySlug;
}

async function wipePrevious(db, tenantId) {
  const q = { tenantId };
  const results = await Promise.all([
    db.collection('bills').deleteMany({ ...q, description: MARK }),
    db.collection('vendors').deleteMany({ ...q, notes: MARK }),
    db.collection('smsmessages').deleteMany({ ...q, twilioSid: { $regex: `^${SMS_SID_PREFIX}` } }),
    db.collection('websiteanalyticsevents').deleteMany({ ...q, sessionId: { $regex: `^${SESSION_PREFIX}` } }),
    db.collection('userauditlogs').deleteMany({ ...q, locationIsp: AUDIT_ISP }),
    db.collection('rfidscans').deleteMany({ ...q, source: RFID_SOURCE }),
    db.collection('rfidtags').deleteMany({ ...q, notes: MARK }),
    db.collection('rfidpins').deleteMany({ ...q, notes: MARK }),
    db.collection('rfidphones').deleteMany({ ...q, notes: MARK }),
    db.collection('activities').deleteMany({ ...q, note: { $regex: `^\\${MARK}` } }),
    db.collection('tasks').deleteMany({ ...q, description: MARK }),
    db.collection('appointments').deleteMany({ ...q, notes: MARK }),
    db.collection('employeecontacts').deleteMany({ ...q, email: { $regex: /@demo\.scww$/ } }),
  ]);
  return results.reduce((n, r) => n + (r.deletedCount || 0), 0);
}

function billDocs(tenantId, now) {
  return [
    { title: 'Shop lease', vendor: 'Capistrano Commerce Park', category: 'rent', dueDay: 1, description: MARK },
    { title: 'SoCal Gas', vendor: 'SoCalGas', category: 'utilities', dueDay: 18, description: MARK },
    { title: 'Waste Management', vendor: 'WM', category: 'utilities', dueDay: 22, description: MARK },
    { title: 'Microsoft 365', vendor: 'Microsoft', category: 'software', dueDay: 5, description: MARK },
    { title: 'QuickBooks', vendor: 'Intuit', category: 'software', dueDay: 8, description: MARK },
    { title: 'Adobe Creative Cloud', vendor: 'Adobe', category: 'software', dueDay: 11, description: MARK },
    { title: 'Hardwood account', vendor: 'White’s Hardwood', category: 'supplies', dueDay: 10, description: MARK },
    { title: 'Iron & rail materials', vendor: 'South Coast Steel', category: 'supplies', dueDay: 15, description: MARK },
    { title: 'Shop tools / Fastenal', vendor: 'Fastenal', category: 'equipment', dueDay: 16, description: MARK },
    { title: 'Auto fuel card', vendor: 'WEX', category: 'other', dueDay: 25, description: MARK },
    { title: 'General liability', vendor: 'Hartford', category: 'insurance', dueDay: 3, description: MARK },
  ].map((row) => ({
    _id: oid(),
    tenantId,
    ...row,
    billUrl: '',
    createdAt: now,
    updatedAt: now,
  }));
}

function vendorDocs(tenantId, createdBy, now) {
  const rows = [
    {
      name: 'Ganahl Lumber',
      category: 'lumber',
      primaryPhone: '(949) 645-2444',
      primaryEmail: 'orders@ganahl-lumber.example',
      address: { street: '1220 E Katella Ave', city: 'Orange', state: 'CA', zip: '92867' },
      tags: ['oak', 'treads', 'delivery'],
      orderItems: [
        { itemCode: 'OAK-TRD-11', description: 'White oak tread 11.5 in', productNumber: 'WO-115' },
        { itemCode: 'OAK-RIS-7', description: 'White oak riser 7.5 in', productNumber: 'WO-75' },
      ],
    },
    {
      name: 'White’s Hardwood',
      category: 'lumber',
      primaryPhone: '(714) 555-2201',
      primaryEmail: 'sales@whiteshardwood.example',
      address: { street: '1810 N Main St', city: 'Santa Ana', state: 'CA', zip: '92706' },
      tags: ['walnut', 'maple'],
      orderItems: [{ itemCode: 'WAL-8/4', description: 'Walnut 8/4 FAS', productNumber: 'W84' }],
    },
    {
      name: 'White Cap',
      category: 'hardware',
      primaryPhone: '(949) 555-4410',
      primaryEmail: 'oc@whitecap.example',
      address: { street: '2300 S Yale St', city: 'Santa Ana', state: 'CA', zip: '92704' },
      tags: ['fasteners', 'job-site'],
    },
    {
      name: 'Fastenal',
      category: 'hardware',
      primaryPhone: '(949) 555-1188',
      primaryEmail: 'sanclemente@fastenal.example',
      address: { street: '1020 Calle Sombra', city: 'San Clemente', state: 'CA', zip: '92673' },
      tags: ['bolts', 'anchors'],
    },
    {
      name: 'Sherwin-Williams',
      category: 'supplier',
      primaryPhone: '(949) 555-9090',
      primaryEmail: 'sw.sc@example.com',
      address: { street: '638 Camino de los Mares', city: 'San Clemente', state: 'CA', zip: '92673' },
      tags: ['stain', 'finish'],
      orderItems: [{ itemCode: 'STN-PROV', description: 'Provence oil stain gal', productNumber: 'SW-PV' }],
    },
    {
      name: 'Vista Paint',
      category: 'supplier',
      primaryPhone: '(949) 555-3302',
      primaryEmail: 'vista@example.com',
      address: { street: '2700 S Grand Ave', city: 'Santa Ana', state: 'CA', zip: '92705' },
      tags: ['primer', 'paint'],
    },
    {
      name: 'South Coast Steel',
      category: 'subcontractor',
      primaryPhone: '(714) 555-6700',
      primaryEmail: 'shop@southcoaststeel.example',
      address: { street: '1540 E Edinger Ave', city: 'Santa Ana', state: 'CA', zip: '92705' },
      tags: ['iron', 'rail', 'stringers'],
    },
    {
      name: 'OC Ironworks',
      category: 'subcontractor',
      primaryPhone: '(949) 555-8123',
      primaryEmail: 'info@ocironworks.example',
      address: { street: '34000 Camino Capistrano', city: 'San Juan Capistrano', state: 'CA', zip: '92675' },
      tags: ['balusters', 'newel'],
    },
    {
      name: 'McCabe Stair Parts',
      category: 'supplier',
      primaryPhone: '(800) 555-0199',
      primaryEmail: 'parts@mccabe.example',
      address: { street: '12 Commerce Dr', city: 'Riverside', state: 'CA', zip: '92507' },
      tags: ['newels', 'caps'],
    },
    {
      name: 'Coastal Delivery Co',
      category: 'delivery',
      primaryPhone: '(949) 555-4545',
      primaryEmail: 'dispatch@coastaldel.example',
      address: { street: '1 Avenida Pico', city: 'San Clemente', state: 'CA', zip: '92672' },
      tags: ['jobsite', 'liftgate'],
    },
  ];
  return rows.map((row) => ({
    _id: oid(),
    tenantId,
    createdBy,
    notes: MARK,
    phones: row.primaryPhone ? [row.primaryPhone] : [],
    emails: row.primaryEmail ? [row.primaryEmail] : [],
    contactPhones: row.primaryPhone ? [{ label: 'Main', value: row.primaryPhone }] : [],
    contactEmails: row.primaryEmail ? [{ label: 'Orders', value: row.primaryEmail }] : [],
    addresses: row.address ? [{ ...row.address, fullAddress: `${row.address.street}, ${row.address.city}, ${row.address.state} ${row.address.zip}` }] : [],
    createdAt: now,
    updatedAt: now,
    ...row,
  }));
}

function seedWebsiteTraffic(tenantId, rng, now) {
  const cities = [
    ['San Clemente', 'California', '72.199.41.'],
    ['Dana Point', 'California', '76.80.12.'],
    ['San Juan Capistrano', 'California', '70.167.88.'],
    ['Laguna Niguel', 'California', '68.107.22.'],
    ['Mission Viejo', 'California', '47.149.10.'],
    ['Irvine', 'California', '108.184.55.'],
    ['Newport Beach', 'California', '174.65.201.'],
    ['Los Angeles', 'California', '35.236.11.'],
  ];
  const agents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36',
  ];
  const paths = ['/', '/gallery', '/about', '/projects', '/contact'];
  const docs = [];
  const start = new Date(now.getTime() - 50 * 86400000);
  let sid = 1;
  for (const day of eachDay(start, now)) {
    const { y, m, d } = ymdParts(day);
    const wd = weekdayPacific(day);
    const weekend = wd === 0 || wd === 6;
    const sessions = weekend ? jitter(rng, 3, 10) : jitter(rng, 10, 28);
    for (let s = 0; s < sessions; s += 1) {
      const [city, region, ipBase] = pick(rng, cities);
      const ip = `${ipBase}${jitter(rng, 10, 220)}`;
      const sessionId = `${SESSION_PREFIX}${pad(sid)}`;
      sid += 1;
      const ads = rng() < 0.38;
      const query = ads ? `gclid=${SESSION_PREFIX}${sid}x` : '';
      const referrer = ads ? 'https://www.google.com/' : rng() < 0.25 ? 'https://www.instagram.com/' : '';
      const hour = weekend ? jitter(rng, 9, 20) : jitter(rng, 7, 21);
      const land = atPacific(y, m, d, hour, jitter(rng, 0, 59), jitter(rng, 0, 59));
      const ua = pick(rng, agents);
      const loc = {
        locationCity: city,
        locationRegion: region,
        locationCountry: 'United States',
        locationLabel: `${city}, ${region}`,
        locationIsp: pick(rng, ['Cox Communications', 'Spectrum', 'AT&T']),
      };
      const base = {
        tenantId,
        sessionId,
        ip,
        userAgent: ua,
        referrer,
        query,
        ...loc,
      };
      const landPath = ads || rng() < 0.7 ? '/' : pick(rng, paths);
      docs.push({
        _id: oid(),
        ...base,
        type: 'page_view',
        path: landPath,
        label: landPath === '/' ? 'Home' : landPath.slice(1),
        occurredAt: land,
        createdAt: land,
        updatedAt: land,
      });
      if (rng() < 0.55) {
        const clickAt = new Date(land.getTime() + jitter(rng, 8, 90) * 1000);
        const href = pick(rng, ['/gallery', '/projects', '/contact', 'mailto:office@sanclementewoodworking.com']);
        docs.push({
          _id: oid(),
          ...base,
          type: 'click',
          path: landPath,
          href,
          label: href.startsWith('/') ? href.slice(1) : 'Contact',
          occurredAt: clickAt,
          createdAt: clickAt,
          updatedAt: clickAt,
        });
        if (href.startsWith('/')) {
          docs.push({
            _id: oid(),
            ...base,
            type: 'page_view',
            path: href,
            label: href.slice(1),
            occurredAt: new Date(clickAt.getTime() + 1200),
            createdAt: new Date(clickAt.getTime() + 1200),
            updatedAt: new Date(clickAt.getTime() + 1200),
          });
        }
      }
      if (rng() < 0.12) {
        const openAt = new Date(land.getTime() + jitter(rng, 20, 180) * 1000);
        docs.push({
          _id: oid(),
          ...base,
          type: 'contact_open',
          path: '/contact',
          label: 'Contact form',
          occurredAt: openAt,
          createdAt: openAt,
          updatedAt: openAt,
        });
        if (rng() < 0.42) {
          const submitAt = new Date(openAt.getTime() + jitter(rng, 40, 240) * 1000);
          docs.push({
            _id: oid(),
            ...base,
            type: 'contact_submit',
            path: '/contact',
            label: 'Quote request',
            occurredAt: submitAt,
            createdAt: submitAt,
            updatedAt: submitAt,
          });
        }
      }
    }
  }
  return docs;
}

const AUDIT_PAGES = [
  ['/dashboard', 'Dashboard'],
  ['/pipeline', 'Pipeline'],
  ['/calendar', 'Calendar'],
  ['/customers', 'Customers'],
  ['/messages', 'Messages'],
  ['/tasks', 'Projects & Tasks'],
  ['/finance', 'Finance Hub'],
  ['/vendors', 'Vendors'],
  ['/bills', 'Bills'],
  ['/payroll', 'Payroll'],
  ['/completed-jobs', 'Completed Jobs'],
  ['/completed-tasks', 'Weekly Activity Log'],
  ['/rfid', 'RFID scans'],
];

function seedTeamActivity(tenantId, users, rng, now) {
  const docs = [];
  const start = new Date(now.getTime() - 32 * 86400000);
  const office = users.filter((u) => u.role !== 'shop_view');
  for (const day of eachDay(start, now)) {
    const { y, m, d } = ymdParts(day);
    const wd = weekdayPacific(day);
    if (wd === 0) continue;
    for (const user of office) {
      const skipRate = wd === 6 ? 0.65 : user.role === 'employee' ? 0.22 : 0.08;
      if (rng() > 1 - skipRate) continue;
      const loginAt = atPacific(y, m, d, jitter(rng, 6, 8), jitter(rng, 5, 55));
      const loc = {
        ip: `70.167.40.${jitter(rng, 20, 80)}`,
        locationCity: 'San Clemente',
        locationRegion: 'California',
        locationCountry: 'United States',
        locationLabel: 'San Clemente, California',
        locationIsp: AUDIT_ISP,
        locationSource: 'ip',
      };
      const push = (type, label, path, occurredAt, detail = '') => {
        docs.push({
          _id: oid(),
          tenantId,
          userId: user._id,
          type,
          label,
          path,
          detail,
          occurredAt,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          ...loc,
        });
      };
      push('login', 'Signed in', '/dashboard', loginAt);
      const views = wd === 6 ? jitter(rng, 2, 6) : jitter(rng, 8, 22);
      let t = loginAt.getTime();
      for (let i = 0; i < views; i += 1) {
        t += jitter(rng, 90, 900) * 1000;
        const [path, label] = pick(rng, AUDIT_PAGES);
        push('page_view', `Opened ${label}`, path, new Date(t));
        const clicks = jitter(rng, 1, 4);
        for (let c = 0; c < clicks; c += 1) {
          t += jitter(rng, 8, 70) * 1000;
          push('click', `Clicked ${label}`, path, new Date(t), pick(rng, ['Open job', 'Save', 'Filter', 'Send', 'View']));
        }
      }
      if (wd !== 6 && rng() < 0.92) {
        const out = atPacific(y, m, d, jitter(rng, 16, 18), jitter(rng, 0, 50));
        if (out > loginAt) push('logout', 'Signed out', '/dashboard', out);
      }
    }
  }
  return docs;
}

function smsSid(n) {
  return `${SMS_SID_PREFIX}${String(n).padStart(6, '0')}`;
}

function seedSms(tenantId, users, customers, rng, now) {
  const admin = users.find((u) => u.role === 'super_admin') || users[0];
  const threads = [
    {
      name: 'Earl Mantids',
      phone: '+19495557777',
      lines: [
        ['out', 'Hi Earl — this is SCWW. We can install at 26541 Paseo Callado Tue 7:30am. Does that work?', 18, 8, 12],
        ['in', 'Tuesday is good. Should we move cars out of the garage?', 18, 8, 40],
        ['out', 'Yes please, and leave a 4 ft path from the driveway to the stairs. We’ll text when we’re 20 min out.', 18, 9, 5],
        ['in', 'Sounds good. See you Tuesday.', 18, 9, 18],
        ['out', 'On our way — about 20 minutes out.', 2, 6, 40],
        ['in', 'Gate code is 4419. Coffee is on.', 2, 6, 52],
      ],
    },
    {
      name: 'Brenda Scott',
      phone: '+19495558787',
      lines: [
        ['out', 'Brenda, your stair estimate is ready. Oak box treads, iron balusters, $28,400. Want me to send the PDF?', 16, 10, 4],
        ['in', 'Yes please. Can we do a darker stain?', 16, 11, 22],
        ['out', 'We can. Provence or Jacobean both look great with that iron. I’ll note Jacobean on the worksheet.', 16, 11, 48],
        ['in', 'Jacobean. I’ll talk to my husband tonight.', 16, 18, 2],
        ['out', 'Sounds good — I’ll follow up Thursday.', 16, 18, 10],
      ],
    },
    {
      name: 'Candice Gramms',
      phone: '+19495551387',
      lines: [
        ['out', 'Candice — fabrication is done on 19. Crew is scheduled Thursday 7am.', 9, 15, 3],
        ['in', 'Perfect. Dogs will be at my sister’s.', 9, 15, 41],
        ['out', 'Thank you. We’ll protect the floors and wrap the newels before we leave.', 9, 16, 2],
      ],
    },
    {
      name: 'Chad Diamond',
      phone: '+17145558888',
      lines: [
        ['out', 'Hi Chad, we received the deposit. Contract is signed. Next step is shop drawings this week.', 12, 9, 15],
        ['in', 'Awesome. When do you need the stain choice?', 12, 9, 40],
        ['out', 'By Friday if you can. I’ll text two samples.', 12, 9, 51],
        ['in', 'Got the samples. Going with the lighter oak.', 8, 19, 6],
        ['out', 'Logged. Thank you.', 8, 19, 12],
      ],
    },
    {
      name: 'Daniel Joshinyu',
      phone: '+17145559459',
      lines: [
        ['in', 'Do you guys do floating treads with glass rail?', 6, 14, 8],
        ['out', 'We do. Can send recent photos. What’s the city?', 6, 14, 22],
        ['in', 'Irvine. Two story, open to the foyer.', 6, 14, 35],
        ['out', 'Great. I can do a site visit next Wednesday 11am. That work?', 6, 14, 44],
        ['in', 'Wednesday 11 is fine.', 6, 15, 3],
        ['out', 'Booked. We’ll send a calendar invite.', 6, 15, 8],
      ],
    },
    {
      name: 'Broc Steele',
      phone: '+19495556565',
      lines: [
        ['in', 'One of the iron balusters on the landing is a little loose. Can someone look?', 4, 17, 10],
        ['out', 'Sorry about that. We can punch it Friday afternoon. Anyone home after 2?', 4, 17, 28],
        ['in', 'Yes. Use the side gate.', 4, 17, 36],
        ['out', 'We’ll be there Friday ~2:15.', 4, 17, 41],
      ],
    },
    {
      name: 'Abigail Willingworth',
      phone: '+19495550198',
      lines: [
        ['out', 'Reminder: measure appointment tomorrow 9:30am in San Clemente.', 1, 16, 4],
        ['in', 'We’ll be here. Should I pull the old carpet first?', 1, 16, 29],
        ['out', 'Leave it — easier for us to see the structure. Thank you.', 1, 16, 35],
      ],
    },
    {
      name: 'Felix Ramirez',
      phone: '+19495552001',
      lines: [
        ['in', 'On site at Mantids. Demo of the old oak is done.', 2, 7, 55],
        ['out', 'Copy. Photos when you can. Hardware is in the white van.', 2, 8, 2],
        ['in', 'Need two more 5/8 lags. Stopping at Fastenal.', 2, 10, 14],
        ['out', 'Grab a box. Put it on the shop account.', 2, 10, 18],
        ['in', 'Heading back to the shop, out at 2:40.', 2, 14, 42],
        ['out', 'Thanks Felix.', 2, 14, 45],
      ],
    },
  ];

  const docs = [];
  let n = 1;
  const unreadFrom = new Set(['Broc Steele', 'Daniel Joshinyu']);
  for (const thread of threads) {
    for (const [dir, body, daysAgo, hour, minute] of thread.lines) {
      const when = new Date(now.getTime() - daysAgo * 86400000);
      const { y, m, d } = ymdParts(when);
      const at = atPacific(y, m, d, hour, minute, jitter(rng, 0, 40));
      const outbound = dir === 'out';
      const read = outbound || !unreadFrom.has(thread.name);
      docs.push({
        _id: oid(),
        tenantId,
        direction: outbound ? 'outbound' : 'inbound',
        from: outbound ? SHOP_FROM : thread.phone,
        to: outbound ? thread.phone : SHOP_FROM,
        body,
        twilioSid: smsSid(n),
        deliveryStatus: outbound ? 'delivered' : undefined,
        deliveredAt: outbound ? at : undefined,
        readAt: read && !outbound ? at : undefined,
        statusUpdatedAt: at,
        source: outbound ? 'adhoc' : 'inbound',
        createdBy: outbound ? admin._id : undefined,
        createdAt: at,
        updatedAt: at,
      });
      n += 1;
    }
  }
  return docs;
}

function rfidEmployees() {
  return [
    { name: 'Jake Estrada', uid: null, pin: '4821', phone: '+19495552010', rate: '42', in: '600', out: '1430', days: [1, 2, 3, 4, 5] },
    { name: 'Edgar W. Dikjstra', uid: null, pin: '1937', phone: '+19495552011', rate: '38', in: '600', out: '1430', days: [1, 2, 3, 4, 5] },
    { name: 'Vint Cerf', uid: null, pin: '1969', phone: '+19495552012', rate: '36', in: '630', out: '1400', days: [1, 3, 5] },
    { name: 'Ada Lovelace', uid: '44-18-201-77-9', pin: '2210', phone: '+19495552013', rate: '34', in: '600', out: '1430', days: [1, 2, 3, 4, 5] },
    { name: 'Grace Hopper', uid: '91-4-12-200-33', pin: '3344', phone: '+19495552014', rate: '33', in: '600', out: '1500', days: [1, 2, 3, 4] },
    { name: 'Felix Ramirez', uid: '12-88-43-17-6', pin: '5502', phone: '+19495552001', rate: '32', in: '545', out: '1430', days: [1, 2, 3, 4, 5] },
  ];
}

function seedRfid(tenantId, existingTags, rng, now) {
  const byName = new Map(existingTags.map((t) => [String(t.displayName || '').toLowerCase(), t]));
  const tags = [];
  const pins = [];
  const phones = [];
  const profiles = [];
  const scans = [];
  const contacts = [];

  const start = new Date(now.getTime() - 42 * 86400000);
  for (const emp of rfidEmployees()) {
    const existing = byName.get(emp.name.toLowerCase());
    const uid = existing?.uid || emp.uid;
    if (!existing && uid) {
      tags.push({
        _id: oid(),
        tenantId,
        uid,
        displayName: emp.name,
        notes: MARK,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    pins.push({
      _id: oid(),
      tenantId,
      pin: emp.pin,
      displayName: emp.name,
      notes: MARK,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const digits = emp.phone.replace(/\D/g, '').slice(-10);
    phones.push({
      _id: oid(),
      tenantId,
      phone: emp.phone,
      phoneDigits: digits,
      displayName: emp.name,
      notes: MARK,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    profiles.push({
      _id: oid(),
      tenantId,
      employeeKey: emp.name.toLowerCase(),
      displayName: emp.name,
      shiftIn: emp.in,
      shiftOut: emp.out,
      breakMinutes: 30,
      ratePerHour: emp.rate,
      createdAt: now,
      updatedAt: now,
    });
    if (!existing) {
      contacts.push({
        _id: oid(),
        tenantId,
        name: emp.name,
        email: `${emp.name.split(' ')[0].toLowerCase()}@demo.scww`,
        mobile: emp.phone,
        previousPhoneNumbers: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const day of eachDay(start, now)) {
      const { y, m, d } = ymdParts(day);
      const wd = weekdayPacific(day);
      if (!emp.days.includes(wd)) continue;
      if (rng() < 0.08) continue;
      const inToken = String(emp.in).padStart(4, '0');
      const outToken = String(emp.out).padStart(4, '0');
      const inH = Number(inToken.slice(0, 2)) || 6;
      const inM = Number(inToken.slice(2)) || 0;
      const outH = Number(outToken.slice(0, 2)) || 14;
      const outM = Number(outToken.slice(2)) || 30;
      const punchIn = atPacific(y, m, d, inH, Math.max(0, inM + jitter(rng, -12, 18)), jitter(rng, 0, 50));
      let punchOutH = outH;
      let punchOutM = outM + jitter(rng, -20, 35);
      if (punchOutM >= 60) {
        punchOutH += 1;
        punchOutM -= 60;
      }
      if (punchOutM < 0) {
        punchOutH -= 1;
        punchOutM += 60;
      }
      const punchOut = atPacific(y, m, d, punchOutH, punchOutM, jitter(rng, 0, 50));
      const tagUid = uid || `PIN-${emp.pin}`;
      const mk = (when, kind) => ({
        _id: oid(),
        tenantId,
        uid: tagUid,
        pin: uid ? '' : emp.pin,
        displayName: emp.name,
        scannedAt: when,
        source: RFID_SOURCE,
        deviceLabel: kind === 'in' ? 'shop door' : 'shop door',
        createdAt: when,
        updatedAt: when,
      });
      scans.push(mk(punchIn, 'in'), mk(punchOut, 'out'));
    }
  }
  return { tags, pins, phones, profiles, scans, contacts };
}

const STAGE_FLOW = [
  ['APPOINTMENT_SCHEDULED', 'ESTIMATE_IN_PROGRESS'],
  ['ESTIMATE_IN_PROGRESS', 'ESTIMATE_SENT'],
  ['ESTIMATE_SENT', 'ENGAGED_DESIGN_REVIEW'],
  ['ENGAGED_DESIGN_REVIEW', 'CONTRACT_OUT'],
  ['CONTRACT_OUT', 'CONTRACT_SIGNED'],
  ['CONTRACT_SIGNED', 'DEPOSIT_PENDING'],
  ['DEPOSIT_PENDING', 'JOB_PREP'],
  ['JOB_PREP', 'TAKEOFF_COMPLETE'],
  ['TAKEOFF_COMPLETE', 'READY_TO_SCHEDULE'],
  ['READY_TO_SCHEDULE', 'SCHEDULED'],
  ['SCHEDULED', 'IN_PRODUCTION'],
  ['IN_PRODUCTION', 'INSTALLED'],
  ['INSTALLED', 'FINAL_PAYMENT_CLOSED'],
];

function seedWorkLog(tenantId, users, jobs, customers, rng, now) {
  const admin = users.find((u) => u.email?.includes('demo+')) || users.find((u) => u.role === 'super_admin') || users[0];
  const actors = users.filter((u) => u.role !== 'shop_view');
  const activities = [];
  const tasks = [];
  const appointments = [];
  if (!jobs.length) return { activities, tasks, appointments };

  const start = new Date(now.getTime() - 28 * 86400000);
  let jobIdx = 0;
  for (const day of eachDay(start, now)) {
    const { y, m, d } = ymdParts(day);
    const wd = weekdayPacific(day);
    if (wd === 0 || wd === 6) continue;
    const actor = pick(rng, actors);
    const job = jobs[jobIdx % jobs.length];
    jobIdx += 1;
    const customerId = job.customerId || pick(rng, customers)?._id;
    const at = atPacific(y, m, d, jitter(rng, 8, 16), jitter(rng, 0, 55));
    const pair = STAGE_FLOW.find((row) => row[1] === job.stage) || pick(rng, STAGE_FLOW);
    activities.push({
      _id: oid(),
      tenantId,
      type: 'stage_change',
      jobId: job._id,
      customerId,
      fromStage: pair[0],
      toStage: job.stage || pair[1],
      note: `${MARK} Moved ${job.title || 'job'} forward`,
      createdBy: actor._id,
      createdAt: at,
      updatedAt: at,
    });
    if (rng() < 0.7) {
      const sched = new Date(at.getTime() + 20 * 60000);
      activities.push({
        _id: oid(),
        tenantId,
        type: 'job_scheduled',
        jobId: job._id,
        customerId,
        note: `${MARK} Install window set for ${job.title || 'job'}`,
        createdBy: actor._id,
        createdAt: sched,
        updatedAt: sched,
      });
    }
    if (rng() < 0.85) {
      const doneAt = new Date(at.getTime() + 40 * 60000);
      const title = pick(rng, [
        'Call customer with stain options',
        'Order oak treads',
        'Site measure follow-up',
        'Send revised estimate',
        'Confirm deposit received',
        'Schedule iron sub',
      ]);
      const taskId = oid();
      tasks.push({
        _id: taskId,
        tenantId,
        jobId: job._id,
        customerId,
        title,
        description: MARK,
        type: 'follow_up',
        priority: 'medium',
        assignedTo: actor._id,
        createdBy: admin._id,
        completedAt: doneAt,
        completedBy: actor._id,
        createdAt: at,
        updatedAt: doneAt,
      });
      activities.push({
        _id: oid(),
        tenantId,
        type: 'task_completed',
        jobId: job._id,
        customerId,
        taskId,
        note: `${MARK} ${title}`,
        createdBy: actor._id,
        createdAt: doneAt,
        updatedAt: doneAt,
      });
    }
    if (rng() < 0.55) {
      const apptHour = jitter(rng, 9, 15);
      const apptMin = pick(rng, [0, 30]);
      const apptAt = atPacific(y, m, d, apptHour, apptMin);
      const apptId = oid();
      const who = customers[jobIdx % customers.length];
      const h12 = ((apptHour + 11) % 12) + 1;
      appointments.push({
        _id: apptId,
        tenantId,
        title: `Site visit — ${who?.name || job.title}`,
        date: apptAt,
        time: `${h12}:${pad(apptMin)} ${apptHour >= 12 ? 'PM' : 'AM'}`,
        reason: 'Measure / design',
        location: job.jobAddress?.street || 'San Clemente',
        notes: MARK,
        status: 'completed',
        jobId: job._id,
        customerId: who?._id || customerId,
        customerName: who?.name || job.title,
        completedAt: apptAt,
        createdBy: actor._id,
        createdAt: apptAt,
        updatedAt: apptAt,
      });
      activities.push({
        _id: oid(),
        tenantId,
        type: 'appointment_completed',
        jobId: job._id,
        customerId: who?._id || customerId,
        note: `${MARK} Finished site visit`,
        createdBy: actor._id,
        createdAt: apptAt,
        updatedAt: apptAt,
      });
    }
    if (rng() < 0.2) {
      const created = new Date(at.getTime() + 5 * 60000);
      activities.push({
        _id: oid(),
        tenantId,
        type: 'job_created',
        jobId: job._id,
        customerId,
        note: `${MARK} New inquiry logged`,
        createdBy: actor._id,
        createdAt: created,
        updatedAt: created,
      });
    }
  }
  return { activities, tasks, appointments };
}

async function insert(col, docs, dryRun, label) {
  if (!docs.length) {
    console.log(`  ${label}: 0`);
    return 0;
  }
  if (dryRun) {
    console.log(`  ${label}: ${docs.length} (dry run)`);
    return docs.length;
  }
  await col.insertMany(docs, { ordered: false });
  console.log(`  ${label}: ${docs.length}`);
  return docs.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = String(args.dryRun || '').toLowerCase() === 'true';
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const tenant = await resolveTenant(args);
  const tenantId = tenant._id;
  const rng = mulberry32(hashSeed(String(tenant.slug)));
  const now = new Date();
  const db = mongoose.connection.db;

  console.log(`Tenant: ${tenant.slug} (${tenant.name}) ${tenantId}`);
  if (dryRun) console.log('Dry run — no writes');

  const wiped = dryRun ? 0 : await wipePrevious(db, tenantId);
  console.log(`Cleared previous demo seed rows: ${wiped}`);

  const users = await db.collection('users').find({ tenantId }).project({ name: 1, email: 1, role: 1 }).toArray();
  const jobs = await db.collection('jobs').find({ tenantId }).project({ title: 1, stage: 1, customerId: 1, jobAddress: 1 }).toArray();
  const customers = await db.collection('customers').find({ tenantId }).project({ name: 1, primaryPhone: 1 }).toArray();
  const existingTags = await db.collection('rfidtags').find({ tenantId }).project({ uid: 1, displayName: 1 }).toArray();
  const createdBy = users.find((u) => String(u.email || '').includes('demo+'))?._id
    || users.find((u) => u.role === 'super_admin')?._id
    || users[0]?._id;
  if (!createdBy) throw new Error('No users on this tenant to attach vendors/activities to.');

  const bills = billDocs(tenantId, now);
  const vendors = vendorDocs(tenantId, createdBy, now);
  const traffic = seedWebsiteTraffic(tenantId, rng, now);
  const audit = seedTeamActivity(tenantId, users, rng, now);
  const sms = seedSms(tenantId, users, customers, rng, now);
  const rfid = seedRfid(tenantId, existingTags, rng, now);
  const work = seedWorkLog(tenantId, users, jobs, customers, rng, now);

  console.log('Inserting...');
  await insert(db.collection('bills'), bills, dryRun, 'bills');
  await insert(db.collection('vendors'), vendors, dryRun, 'vendors');
  await insert(db.collection('websiteanalyticsevents'), traffic, dryRun, 'website traffic');
  await insert(db.collection('userauditlogs'), audit, dryRun, 'team activity');
  await insert(db.collection('smsmessages'), sms, dryRun, 'sms');
  await insert(db.collection('rfidtags'), rfid.tags, dryRun, 'rfid tags');
  await insert(db.collection('rfidpins'), rfid.pins, dryRun, 'rfid pins');
  await insert(db.collection('rfidphones'), rfid.phones, dryRun, 'rfid phones');
  await insert(db.collection('rfidscans'), rfid.scans, dryRun, 'rfid scans');
  await insert(db.collection('employeecontacts'), rfid.contacts, dryRun, 'employee contacts');
  await insert(db.collection('activities'), work.activities, dryRun, 'activities');
  await insert(db.collection('tasks'), work.tasks, dryRun, 'completed tasks');
  await insert(db.collection('appointments'), work.appointments, dryRun, 'appointments');

  if (!dryRun) {
    for (const profile of rfid.profiles) {
      await db.collection('rfidemployeeprofiles').updateOne(
        { tenantId, employeeKey: profile.employeeKey },
        {
          $set: {
            displayName: profile.displayName,
            shiftIn: profile.shiftIn,
            shiftOut: profile.shiftOut,
            breakMinutes: profile.breakMinutes,
            ratePerHour: profile.ratePerHour,
            updatedAt: now,
          },
          $setOnInsert: { _id: profile._id, tenantId, employeeKey: profile.employeeKey, createdAt: now },
        },
        { upsert: true },
      );
    }
    console.log(`  rfid profiles: ${rfid.profiles.length} upserted`);

    await WebsiteContent.updateOne(
      { tenantId },
      { $set: { 'analytics.enabled': true, 'analytics.campaignName': 'Staircase Leads' } },
    ).setOptions({ bypassTenant: true });
    console.log('  website analytics: enabled');
  }

  console.log('Demo showcase seed complete.');
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
