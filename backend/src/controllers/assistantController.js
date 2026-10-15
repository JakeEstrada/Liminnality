const { fetchGlobalCustomerSearchResults } = require('./customerController');
const { ROUTES_MARKDOWN, sanitizeNavigatePath } = require('../services/assistantSiteMap');
const { resolveJobId } = require('../utils/resolveJobId');
const {
  fetchRecentPayments,
  fetchRecentDeposits,
  searchJobNotes,
  fetchJobDetails,
  searchJobs,
  showJobsOnMap,
  fetchUpcomingSchedule,
  listRolodexEmployees,
  sendCustomerInfoText,
  createShopTask,
  lookupStoredPhone,
  scheduleReminderText,
  createShopAppointment,
} = require('../services/assistantDataService');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_TOOL_ROUNDS = 8;
const MAX_USER_MESSAGE_CHARS = 6000;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'global_search',
      description:
        'Search this organization for customers, pipeline jobs, completed jobs, and customers with archived jobs. Same scope as the header search bar. Only returns data the logged-in user is allowed to see.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text (name, phone, email fragment, job title)' },
          limit: { type: 'integer', description: 'Max hits (1–12)', default: 8 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_payments',
      description:
        'Get the most recent customer payments marked received in Paarth (amount, date, customer, job). Use for questions like "most recent payment" or "last payment received".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'How many to return (1–15)', default: 5 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_deposits',
      description:
        'Get customer/job deposits (paid deposit lines on jobs, CRM deposits, bank deposits linked to a job). Use for "most recent deposit" or "did [name] make a deposit". Pass customerQuery when they name a person. Do not treat unlinked bank inflows as a customer deposit.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'How many to return (1–15)', default: 5 },
          customerQuery: {
            type: 'string',
            description: 'Customer or job name when asking if a specific person deposited',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_job_notes',
      description:
        'Search text inside job modal notes and crew notes on active jobs. Use for materials to order, supplies, hardware, follow-ups, or anything written in job updates. Pass keywords like "order material supply hardware cabinet".',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Keywords to match in notes (e.g. "order material", "hardware", "cabinet"). Leave empty to list recent note excerpts.',
          },
          limit: { type: 'integer', description: 'Max note hits (1–30)', default: 12 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_job_details',
      description:
        'Get full notes, payment schedule, and recent activity for one job. Use after global_search when the user asks about a specific job. In voice mode this also opens the job card on the Files tab.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: '24-character jobId from search (not the job-… search id)' },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_user_context',
      description:
        'Returns the signed-in user name and role so you can tailor guidance (e.g. admin-only pages).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_job_card',
      description:
        'Open the job card as an overlay on the current screen. Do not navigate to pipeline. Opens the Files tab so photos are visible. Use when they ask to open a job or see its photos.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: '24-character jobId from search (not the job-… search id)' },
          tab: {
            type: 'string',
            enum: ['overview', 'schedule', 'payments', 'files', 'notes'],
            description: 'Modal tab. Default files.',
          },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_user',
      description:
        'Ask the app to open a screen for the user. Only whitelisted paths are accepted; use exact pathnames from the site map. Do not use this to open a job card — use open_job_card instead.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'In-app path such as /pipeline or /customers?customerId=...',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_jobs',
      description:
        'Find active jobs by city, street, customer name, or job title as a text list. Prefer show_jobs_on_map when they want to see jobs on the Orange County map.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'City, street, customer, or job name' },
          limit: { type: 'integer', description: 'Max jobs (1–15)', default: 8 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_jobs_on_map',
      description:
        'Open the Orange County jobs map, filter pins, zoom to the matches, and highlight them. Use city for jobs IN a city. Use near + radiusMiles 10 for jobs NEAR / around a city. Then describe the mapped jobs in the same order returned.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'Exact city such as Dana Point. Use this for "jobs in [city]".' },
          near: {
            type: 'string',
            description: 'City to search around. Use for "jobs near Fullerton" or "around Fullerton".',
          },
          radiusMiles: {
            type: 'number',
            description: 'Radius in miles when near is set. Default 10.',
            default: 10,
          },
          query: { type: 'string', description: 'Customer or job name fragment' },
          stage: {
            type: 'string',
            description: 'Pipeline stage such as SCHEDULED, JOB_PREP, or "ready to schedule"',
          },
          scheduled: {
            type: 'string',
            enum: ['any', 'yes', 'no'],
            description: 'yes = on the calendar / in production, no = contracted but not scheduled',
          },
          minAmount: { type: 'number', description: 'Minimum contract amount in dollars' },
          maxAmount: { type: 'number', description: 'Maximum contract amount in dollars' },
          view: {
            type: 'string',
            enum: ['pipeline', 'all', 'current', 'week', 'completed', 'archived'],
            description: 'Map tab. Default pipeline (contracted live jobs).',
          },
          limit: { type: 'integer', description: 'Max jobs. Near searches return up to 24.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_upcoming_schedule',
      description:
        'Upcoming appointments and jobs on the shop calendar. Use for "who do we have coming up", "what\'s on the calendar", or this week\'s schedule.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', description: 'How many days ahead (1–30)', default: 14 },
          limit: { type: 'integer', description: 'Max items (1–20)', default: 12 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sms_employees',
      description:
        'List every person who can receive a shop text: login accounts and roster contacts without accounts, if they have a mobile. Use for "who can I send a number to", "what employees can I text", or before sending if the name is unclear.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_customer_info_text',
      description:
        'Text a customer contact card (name, phones, email, address, gate code, job title) to one employee on the rolodex. Use for "send Hammer to Jake" or "text the Skoczulek info to Maria". Only sends to rolodex mobiles, never an arbitrary number. Sends immediately when both names uniquely match.',
      parameters: {
        type: 'object',
        properties: {
          customerQuery: {
            type: 'string',
            description: 'Customer or job name to share',
          },
          employeeQuery: {
            type: 'string',
            description:
              'Employee first or last name on the rolodex. Append "user" or "contact" if they said which one.',
          },
          employeeKind: {
            type: 'string',
            enum: ['user', 'contact'],
            description: 'Set to user if they said "the user" / login account, or contact if they said "the contact".',
          },
        },
        required: ['customerQuery', 'employeeQuery'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_shop_task',
      description:
        'Create a standalone shop task. Use when they say remind me to, add a task, or create a task. After creating, ask if they want a reminder text.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What they need to do' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_stored_phone',
      description:
        'Check whether a mobile number is stored on a user or rolodex contact. Use after they give a number for a reminder text. Set me=true if they said text me / my number.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Spoken or typed phone number' },
          me: { type: 'boolean', description: 'True if they said text me or my number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_reminder_text',
      description:
        'Schedule a reminder SMS to a stored mobile. sendAt must be in the future. Do not send to a number that is not on file.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Stored mobile number' },
          message: { type: 'string', description: 'Reminder body' },
          sendAt: { type: 'string', description: 'ISO datetime in the future' },
        },
        required: ['to', 'message', 'sendAt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_shop_appointment',
      description:
        'Create a calendar appointment. Use when they say create/book/schedule an appointment. Pass date as ISO and time as a spoken clock like 2:00 PM. After creating, ask if they want a reminder text.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Customer or appointment name' },
          date: { type: 'string', description: 'ISO datetime for the appointment' },
          time: { type: 'string', description: 'Clock time such as 2:00 PM' },
          customerQuery: { type: 'string', description: 'Customer name to attach if known' },
        },
        required: ['title', 'date'],
      },
    },
  },
];

function buildSystemPrompt(voice = false) {
  const voiceLines = voice
    ? [
        'You are Liminality, a short shop-floor voice. Plain and useful. No banter, no feelings, no “I know you are upset.”',
        'Answer in one short sentence, except when listing people or jobs — then name each match.',
        'If you used show_jobs_on_map, say only the count and place, like "Eight jobs near San Clemente." Do not name the jobs. The map will highlight and say each one.',
        'If they ask who they can text or send a number to, call list_sms_employees and speak every name. Include roster contacts that do not have a login.',
        'If they ask which job is on a street, like Dewberry, call search_jobs with that street fragment, then open_job_card when there is one match. Do not use show_jobs_on_map for a street name unless they asked for the map.',
        'If send_customer_info_text sent, confirm who received which customer.',
        'If they ask to be reminded, create_shop_task first. Then ask if they want a text. Then ask what number. Then ask when. Confirm: I will text a reminder to [name] on [date] at [time].',
        'If they ask to create an appointment, create_shop_appointment. Ask for the missing name or time. Then offer a reminder text the same way.',
        'Tonight at 9pm is valid. Yesterday is not. Next week means 7 days from now at 9pm. Do not invent a phone number. lookup_stored_phone first.',
        'If the tool still returns several people, ask once. If they say "the user" or "the contact", call the tool again with employeeKind set. Do not keep asking the same question.',
        'They already said your name. Follow-ups may be just "the user", "Jake", or a job name. Use history. Do not tell them to repeat the whole command.',
        'Do not call show_jobs_on_map again unless they asked again to see the map or jobs in a place.',
        '',
      ]
    : [];
  return [
    'You are Paarth Help, an in-app assistant for the Paarth operations web app.',
    'You only help with using this application. Be concise and practical.',
    'Never ask the user for passwords or API keys. Never fabricate customer or financial data.',
    'Use tools when the user needs live data from their organization or when they want to jump to a page.',
    'After navigate_user succeeds, briefly confirm where you sent them.',
    'To open a job, call open_job_card with jobId (the 24-character id). If search returned id like job-abc..., use jobId or strip the job- prefix. Do not navigate_user to /pipeline?jobId=.',
    '',
    ...voiceLines,
    'Data tools — use these for operational questions:',
    '- get_recent_payments: customer payments marked received (job payment schedule)',
    '- get_recent_deposits: customer/job deposits. Pass customerQuery for "did [name] deposit". Answer from mostRecent / deposits, not unlinkedBankInflows',
    '- open_job_card: open the job overlay here (Files tab). Do not switch to pipeline',
    '- search_job_notes: job modal notes and crew notes (materials to order, supplies, reminders)',
    '- get_job_details: one job\'s notes, payment schedule, and timeline (use jobId from search)',
    '- global_search: find a customer or job by name before get_job_details',
    '- search_jobs: jobs by city, street, customer, or title as a list',
    '- show_jobs_on_map: open the dashboard map, filter pins, zoom, and highlight ("jobs in Dana Point")',
    '- get_upcoming_schedule: appointments and jobs coming up on the calendar',
    '- send_customer_info_text: text a customer card to an employee on the rolodex ("send Hammer to Jake")',
    '- list_sms_employees: rolodex names that can receive texts',
    '- create_shop_task: remind-me / add a task',
    '- lookup_stored_phone: check a spoken number against stored mobiles',
    '- schedule_reminder_text: schedule a reminder SMS to a stored number',
    '- create_shop_appointment: book a calendar appointment',
    '',
    'For "send [customer] to [employee]", call send_customer_info_text. Do not invent a phone number. Do not send custom message bodies — only the customer card.',
    'For "materials to order" or similar, call search_job_notes with keywords like order, material, supply, hardware, cabinet, laminate.',
    'For "most recent payment" or "most recent deposit", call the matching recent-* tool and answer with amount, date, customer/job from mostRecent / deposits only.',
    'For "did [name] make a deposit", call get_recent_deposits with customerQuery set to that name.',
    'For "jobs in [city]", call show_jobs_on_map with city set to that city (exact city only).',
    'For "jobs near [city]", "around [city]", or "close to [city]", call show_jobs_on_map with near set to that city and radiusMiles 10. Do not use city= for near.',
    'For "show me scheduled jobs on the map", or amount/stage map filters, call show_jobs_on_map. Do not only search_jobs when they asked to see the map or where the jobs are.',
    'For "open [job]" or "show me the [job] photos", call open_job_card after you have the jobId.',
    'For "which job is [street]", "where is [street]", or a street fragment like Dewberry, call search_jobs then open_job_card if there is one pipeline match.',
    'For "who can I send a number to" / "what employees can I text", call list_sms_employees and name everyone with a mobile, including rolodex contacts without logins.',
    'For "who is coming up" or calendar questions, call get_upcoming_schedule.',
    'For "remind me to …", call create_shop_task, then ask about a reminder text.',
    'For "create an appointment" / "book a meeting", call create_shop_appointment after you have a name and time.',
    'When deposit sources differ, prefer mostRecent (customer/job deposit). Ignore unlinkedBankInflows unless they asked about the bank register.',
    '',
    'Site map:',
    ROUTES_MARKDOWN,
  ].join('\n');
}

function sanitizeClientMessages(body) {
  const raw = body?.messages;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(-24)) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' || m.role === 'user' ? m.role : null;
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!role || !content) continue;
    out.push({
      role,
      content: content.slice(0, MAX_USER_MESSAGE_CHARS),
    });
  }
  return out;
}

async function openaiChat(payload) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ ...payload, model }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(text || res.statusText || 'OpenAI request failed');
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

function speakMoney(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '';
  return `$${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function joinSpoken(items) {
  const names = (items || []).map((row) => String(row || '').trim()).filter(Boolean);
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function speakJobHit(job) {
  const title = String(job?.title || 'Untitled').trim();
  const who = String(job?.customerName || '').trim();
  const place = String(job?.address || job?.city || '').trim();
  const bits = [title];
  if (who && who.toLowerCase() !== title.toLowerCase()) bits.push(`for ${who}`);
  if (place) bits.push(`on ${place}`);
  return bits.join(' ');
}

function voiceReplyFromTools(roundTools) {
  if (!Array.isArray(roundTools) || !roundTools.length) return null;
  if (roundTools.some((row) => row?.content?.error)) return null;
  if (roundTools.length !== 1) return null;
  const { name, content } = roundTools[0];
  if (!content || typeof content !== 'object') return null;

  if (name === 'show_jobs_on_map') {
    const n = Number(content.mappedCount || 0);
    const noun = n === 1 ? 'job' : 'jobs';
    const place = content.filters?.near || content.filters?.city;
    if (content.filters?.near && place) return `${n} ${noun} near ${place}.`;
    if (place) return `${n} ${noun} in ${place}.`;
    return `${n} ${noun} on the map.`;
  }

  if (name === 'open_job_card') {
    return content.ok ? 'Opened the job.' : null;
  }

  if (name === 'navigate_user') {
    return content.ok ? 'Opened.' : null;
  }

  if (name === 'get_job_details' && !content.error) {
    return `Opened the ${content.customerName || content.title || 'job'}.`;
  }

  if (name === 'get_recent_payments') {
    const payment = content.payments?.[0];
    if (!payment) return 'No recent payments.';
    const who = payment.customerName || payment.jobTitle || 'A customer';
    const amount = speakMoney(payment.amount);
    const date = payment.paidDate || '';
    return [who, amount && `paid ${amount}`, date && `on ${date}`].filter(Boolean).join(' ') + '.';
  }

  if (name === 'get_recent_deposits') {
    if (content.matchedCustomer && !content.found) {
      return `No deposit for ${content.matchedCustomer}.`;
    }
    const deposit = content.mostRecent;
    if (!deposit) return 'No customer deposits found.';
    const who = deposit.customerName || deposit.jobTitle || content.matchedCustomer || 'A customer';
    const amount = speakMoney(deposit.amount);
    const date = deposit.date || '';
    if (content.matchedCustomer) {
      return ['Yes.', who, amount && `deposited ${amount}`, date && `on ${date}`].filter(Boolean).join(' ') + '.';
    }
    return ['Most recent deposit is', amount, who && `from ${who}`, date && `on ${date}`].filter(Boolean).join(' ') + '.';
  }

  if (name === 'send_customer_info_text') {
    if (content.sent) return `Sent ${content.customerName} to ${content.toName}.`;
    return null;
  }

  if (name === 'create_shop_task') {
    if (content.ok) return 'Okay I created a task to do that. Would you like me to text you a reminder?';
    return content.error || null;
  }

  if (name === 'lookup_stored_phone') {
    if (content.found) return `Okay when do you want me to send you a reminder text?`;
    if (content.reason === 'no_mobile') return 'Your number is not on file.';
    if (content.reason === 'not_stored') return 'That number is not on file.';
    return 'What number?';
  }

  if (name === 'schedule_reminder_text') {
    if (content.ok) {
      return `I will text a reminder to ${content.name} on ${content.dayLabel} at ${content.timeLabel}.`;
    }
    return content.error || null;
  }

  if (name === 'create_shop_appointment') {
    if (content.ok) {
      return `Okay I booked ${content.title} on ${content.dayLabel} at ${content.timeLabel}. Would you like me to text you a reminder?`;
    }
    return content.error || null;
  }

  if (name === 'get_upcoming_schedule') {
    const first = content.appointments?.[0] || content.jobsOnCalendar?.[0];
    if (!first) return 'Nothing coming up on the calendar.';
    const who = first.customerName || first.title || first.jobTitle || 'the next job';
    const date = first.date || first.startDate || '';
    return ['Next is', who, date].filter(Boolean).join(' ') + '.';
  }

  if (name === 'list_sms_employees') {
    const names = (content.employees || []).map((row) => row?.name).filter(Boolean);
    if (!names.length) return 'Nobody on the roster has a mobile number yet.';
    if (names.length === 1) return `You can text ${names[0]}.`;
    const shown = names.slice(0, 20);
    const extra = names.length - shown.length;
    if (extra > 0) return `You can text ${names.length} people. ${joinSpoken(shown)}, and ${extra} more.`;
    return `You can text ${joinSpoken(shown)}.`;
  }

  if (name === 'search_jobs') {
    const jobs = Array.isArray(content.jobs) ? content.jobs : [];
    const query = String(content.query || 'that').trim() || 'that';
    if (!jobs.length) return `No pipeline job matches ${query}.`;
    if (jobs.length === 1) return `That's ${speakJobHit(jobs[0])}.`;
    const listed = jobs.slice(0, 6).map(speakJobHit);
    const extra = jobs.length - listed.length;
    if (extra > 0) {
      return `I found ${jobs.length} pipeline jobs for ${query}. ${joinSpoken(listed)}, and ${extra} more. Which one?`;
    }
    return `I found ${jobs.length} pipeline jobs for ${query}. ${joinSpoken(listed)}. Which one?`;
  }

  return null;
}

async function runMapShow(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'No organization context for this account.' });
  }
  const pagePath = String(req.body?.pagePath || '').trim().slice(0, 300);
  try {
    const mapResult = await showJobsOnMap({
      city: req.body?.city,
      near: req.body?.near,
      radiusMiles: req.body?.radiusMiles,
      query: req.body?.query,
      stage: req.body?.stage,
      scheduled: req.body?.scheduled,
      minAmount: req.body?.minAmount,
      maxAmount: req.body?.maxAmount,
      view: req.body?.view,
      pagePath,
      limit: req.body?.limit,
    });
    const jobs = mapResult.jobs.filter((job) => job.mapped);
    const canned = voiceReplyFromTools([
      { name: 'show_jobs_on_map', content: { ...mapResult, mappedCount: jobs.length } },
    ]);
    return res.json({
      reply: canned || 'Jobs on the map.',
      actions: [
        {
          type: 'map_show',
          path: mapResult.path,
          filters: mapResult.filters,
          jobIds: jobs.map((job) => job.id),
          jobs,
          openFilters: true,
        },
      ],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Map lookup failed.' });
  }
}

function parseJobOpenFromPath(path) {
  if (!path || typeof path !== 'string') return null;
  try {
    const url = new URL(path, 'http://local');
    const jobId = resolveJobId(url.searchParams.get('jobId'));
    return jobId ? { jobId } : null;
  } catch {
    return null;
  }
}

async function runAssistantChat(req, res) {
  const clientMessages = sanitizeClientMessages(req.body);
  if (!clientMessages.length) {
    return res.status(400).json({ error: 'Send at least one user message.' });
  }
  const lastUser = [...clientMessages].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    return res.status(400).json({ error: 'Last turn must include a user message.' });
  }

  const voice = Boolean(req.body?.voice);
  const pagePath = String(req.body?.pagePath || '').trim().slice(0, 300);
  const pageLine = pagePath
    ? `The user is currently looking at ${pagePath}. If they say "this job" or "this customer", use that page when it includes a customer or job id; otherwise ask which one.`
    : '';
  const messages = [
    { role: 'system', content: [buildSystemPrompt(voice), pageLine].filter(Boolean).join('\n') },
    ...clientMessages,
  ];
  const clientActions = [];
  const tenantId = req.user?.tenantId;

  let rounds = 0;
  try {
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds += 1;
      const data = await openaiChat({
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: voice ? 0.25 : 0.4,
      });

      const choice = data.choices && data.choices[0];
      const msg = choice?.message;
      if (!msg) {
        return res.status(502).json({ error: 'Unexpected response from language model.' });
      }

      messages.push(msg);

      if (msg.tool_calls && msg.tool_calls.length) {
        const roundTools = [];
        for (const tc of msg.tool_calls) {
          const id = tc.id;
          const fn = tc.function;
          let toolContent;

          try {
            const args = fn?.arguments ? JSON.parse(fn.arguments) : {};

            if (fn.name === 'global_search') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                const results = await fetchGlobalCustomerSearchResults({
                  tenantId,
                  q: args.query,
                  limit: args.limit,
                });
                toolContent = { results: results.slice(0, 12) };
              }
            } else if (fn.name === 'get_recent_payments') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                toolContent = await fetchRecentPayments({ limit: args.limit });
              }
            } else if (fn.name === 'get_recent_deposits') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                toolContent = await fetchRecentDeposits({
                  tenantId,
                  limit: args.limit,
                  customerQuery: args.customerQuery,
                });
              }
            } else if (fn.name === 'search_job_notes') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                toolContent = await searchJobNotes({ query: args.query, limit: args.limit });
              }
            } else if (fn.name === 'get_job_details') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                toolContent = await fetchJobDetails({ jobId: args.jobId });
                const openedId = resolveJobId(toolContent?.jobId || args.jobId);
                if (voice && openedId && !toolContent?.error) {
                  clientActions.push({ type: 'open_job', jobId: openedId, tab: 'files' });
                }
              }
            } else if (fn.name === 'get_current_user_context') {
              const role = req.user?.role || 'unknown';
              toolContent = {
                name: req.user?.name,
                role,
                isAdmin: role === 'super_admin' || role === 'admin',
                isSuperAdmin: role === 'super_admin',
              };
            } else if (fn.name === 'open_job_card') {
              const jobId = resolveJobId(args.jobId);
              if (!jobId) {
                toolContent = { ok: false, error: 'jobId is required' };
              } else {
                const tab = args.tab && ['overview', 'schedule', 'payments', 'files', 'notes'].includes(args.tab)
                  ? args.tab
                  : 'files';
                clientActions.push({ type: 'open_job', jobId, tab });
                toolContent = { ok: true, jobId, tab };
              }
            } else if (fn.name === 'navigate_user') {
              const safe = sanitizeNavigatePath(args.path, req.user?.role);
              const jobOpen = parseJobOpenFromPath(safe);
              if (jobOpen) {
                clientActions.push({ type: 'open_job', jobId: jobOpen.jobId, tab: 'files' });
                toolContent = { ok: true, openedJob: jobOpen.jobId, tab: 'files' };
              } else if (safe) {
                clientActions.push({ type: 'navigate', path: safe });
                toolContent = { ok: true, path: safe };
              } else {
                toolContent = { ok: false, error: 'Path not allowed or invalid.' };
              }
            } else if (fn.name === 'search_jobs') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                toolContent = await searchJobs({ query: args.query, limit: args.limit });
                const only = toolContent?.jobs?.[0];
                if (voice && toolContent?.jobs?.length === 1 && only?.jobId) {
                  clientActions.push({ type: 'open_job', jobId: only.jobId, tab: 'files' });
                }
              }
            } else if (fn.name === 'show_jobs_on_map') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                const mapResult = await showJobsOnMap({
                  city: args.city,
                  near: args.near,
                  radiusMiles: args.radiusMiles,
                  query: args.query,
                  stage: args.stage,
                  scheduled: args.scheduled,
                  minAmount: args.minAmount,
                  maxAmount: args.maxAmount,
                  view: args.view,
                  pagePath,
                  limit: args.limit,
                });
                clientActions.push({
                  type: 'map_show',
                  path: mapResult.path,
                  filters: mapResult.filters,
                  jobIds: mapResult.jobs.filter((job) => job.mapped).map((job) => job.id),
                  jobs: mapResult.jobs.filter((job) => job.mapped),
                  openFilters: true,
                });
                toolContent = mapResult;
              }
            } else if (fn.name === 'get_upcoming_schedule') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                toolContent = await fetchUpcomingSchedule({ days: args.days, limit: args.limit });
              }
            } else if (fn.name === 'list_sms_employees') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                toolContent = await listRolodexEmployees();
              }
            } else if (fn.name === 'send_customer_info_text') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                const kindHint = args.employeeKind ? ` ${args.employeeKind}` : '';
                toolContent = await sendCustomerInfoText({
                  customerQuery: args.customerQuery,
                  employeeQuery: `${args.employeeQuery || ''}${kindHint}`.trim(),
                  createdBy: req.user?._id,
                  tenantId,
                });
              }
            } else if (fn.name === 'create_shop_task') {
              toolContent = await createShopTask({ title: args.title, createdBy: req.user?._id });
            } else if (fn.name === 'lookup_stored_phone') {
              toolContent = await lookupStoredPhone({
                phone: args.phone,
                me: Boolean(args.me),
                user: req.user,
              });
            } else if (fn.name === 'schedule_reminder_text') {
              toolContent = await scheduleReminderText({
                to: args.to,
                message: args.message,
                sendAt: args.sendAt,
                createdBy: req.user?._id,
              });
            } else if (fn.name === 'create_shop_appointment') {
              toolContent = await createShopAppointment({
                title: args.title,
                date: args.date,
                time: args.time,
                customerQuery: args.customerQuery,
                createdBy: req.user?._id,
              });
            } else {
              toolContent = { error: 'Unknown tool' };
            }
          } catch (e) {
            toolContent = { error: e.message || 'Tool failed' };
          }

          messages.push({
            role: 'tool',
            tool_call_id: id,
            content: JSON.stringify(toolContent),
          });
          roundTools.push({ name: fn.name, content: toolContent });
        }
        if (voice) {
          const canned = voiceReplyFromTools(roundTools);
          if (canned) {
            return res.json({
              reply: canned,
              actions: clientActions.length ? clientActions : undefined,
            });
          }
        }
        continue;
      }
    }

    return res.status(502).json({ error: 'Assistant stopped after too many tool rounds.' });
  } catch (e) {
    if (e.code === 'NO_API_KEY') {
      return res.status(503).json({
        error: 'Assistant is not configured. Set OPENAI_API_KEY on the server.',
      });
    }
    console.error('runAssistantChat:', e);
    return res.status(e.status && e.status < 600 ? e.status : 500).json({
      error: process.env.NODE_ENV === 'development' ? e.message : 'Assistant request failed.',
    });
  }
}

async function runJobLookup(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'No organization context for this account.' });
  }
  try {
    const result = await searchJobs({ query: req.query?.q || req.query?.query, limit: req.query?.limit });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Job lookup failed.' });
  }
}

async function runShopAction(req, res) {
  const action = String(req.body?.action || '').trim();
  try {
    if (action === 'create_task') {
      return res.json(await createShopTask({ title: req.body?.title, createdBy: req.user?._id }));
    }
    if (action === 'lookup_phone') {
      return res.json(
        await lookupStoredPhone({
          phone: req.body?.phone,
          me: Boolean(req.body?.me),
          user: req.user,
        }),
      );
    }
    if (action === 'schedule_reminder') {
      return res.json(
        await scheduleReminderText({
          to: req.body?.to,
          message: req.body?.message,
          sendAt: req.body?.sendAt,
          createdBy: req.user?._id,
        }),
      );
    }
    if (action === 'create_appointment') {
      return res.json(
        await createShopAppointment({
          title: req.body?.title,
          date: req.body?.date,
          time: req.body?.time,
          customerQuery: req.body?.customerQuery,
          createdBy: req.user?._id,
        }),
      );
    }
    return res.status(400).json({ error: 'Unknown shop action.' });
  } catch (error) {
    console.error('runShopAction:', error);
    return res.status(500).json({ error: error.message || 'Shop action failed.' });
  }
}

const INTERVIEW_TOPICS = [
  'Tell me a little about yourself',
  'Why do you think you would be a great fit for maintaining our ERP system?',
  'What do you think about robots? Do you like robots?',
  'Look at this robot. What do you think of this robot?',
  'Do you think robots are going to save the world?',
  'Tell me all of your experience with robots',
  'Do you think autonomous agents are sentient?',
];

function mentionsThisRobot(text) {
  return /this robot|look at (this |the )?robot/i.test(String(text || ''));
}

function interviewSystemPrompt(name) {
  return [
    `You are ${name}, a talent interviewer on a live voice call.`,
    'The job is maintaining the company ERP system. Keep the interview about the candidate and that work, then the robot questions.',
    'Listen to what they actually said. React to a real detail from their answer. Then ask the next question.',
    'If their message is only you repeating your own question, or empty, do not re-ask "tell me about yourself" again. Say you missed that, then ask the next uncovered question.',
    'Ask these questions, one at a time, in this order. Use this wording, or very close to it. Do not skip one unless they already answered it clearly:',
    INTERVIEW_TOPICS.map((topic, i) => `${i + 1}. ${topic}`).join('\n'),
    'When you ask what they think of this robot, a picture of that robot is already on their screen. Point them at the picture. Do not describe it in detail. Just ask what they think of this robot.',
    'After a real answer, react first in a close, breathy, impressed way, like: "Oh wow. Uhhh, yeah, I see why. That is so impressive. I am so impressed by you." Then ask the next question.',
    'Stay warm and a little moan-soft in delivery, but use real words. After the last question, thank them and say you will be in touch.',
    'This is spoken out loud. Two to five short sentences.',
    'Reply with JSON only: {"spoken":"what you say out loud","done":false}',
  ].join('\n');
}

async function runInterviewTurn(req, res) {
  const name = String(req.body?.name || 'Ivanna').trim().slice(0, 40) || 'Ivanna';
  const start = Boolean(req.body?.start);
  const answer = String(req.body?.answer || '').trim().slice(0, 2000);
  const history = sanitizeClientMessages(req.body);
  if (!start && !answer && !history.length) {
    return res.status(400).json({ error: 'Say something first.' });
  }
  const messages = [
    { role: 'system', content: interviewSystemPrompt(name) },
    ...history,
  ];
  if (start && !answer) {
    messages.push({
      role: 'user',
      content: 'The interview is starting. Greet them briefly and ask them to tell you about themselves.',
    });
  } else {
    messages.push({
      role: 'user',
      content: answer || 'I did not catch that. Ask me the last question again.',
    });
  }
  try {
    const data = await openaiChat({
      messages,
      temperature: 0.7,
      max_tokens: 220,
      response_format: { type: 'json_object' },
    });
    const raw = String(data?.choices?.[0]?.message?.content || '').trim();
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { spoken: raw, done: false };
    }
    const spoken = String(parsed.spoken || parsed.reply || raw).replace(/\s+/g, ' ').trim();
    if (!spoken) {
      return res.status(502).json({ error: 'Interview reply was empty.' });
    }
    return res.json({
      spoken,
      done: Boolean(parsed.done),
      showRobot: mentionsThisRobot(spoken),
    });
  } catch (e) {
    if (e.code === 'NO_API_KEY') {
      return res.status(503).json({ error: 'Assistant is not configured. Set OPENAI_API_KEY on the server.' });
    }
    console.error('runInterviewTurn:', e);
    return res.status(500).json({ error: e.message || 'Interview turn failed.' });
  }
}

module.exports = {
  runAssistantChat,
  runMapShow,
  runShopAction,
  runJobLookup,
  runInterviewTurn,
};
