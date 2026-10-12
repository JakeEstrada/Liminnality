const { fetchGlobalCustomerSearchResults } = require('./customerController');
const { ROUTES_MARKDOWN, sanitizeNavigatePath } = require('../services/assistantSiteMap');
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
        'Get recent deposits: CRM deposit logs, bank deposits linked to jobs, and uncategorized bank register inflows. Use for "most recent deposit" or bank deposit questions.',
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
        'Get full notes, payment schedule, and recent activity for one job. Use after global_search when the user asks about a specific job.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Mongo job id from search results' },
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
      name: 'navigate_user',
      description:
        'Ask the app to open a screen for the user. Only whitelisted paths are accepted; use exact pathnames from the site map.',
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
        'Open the Orange County jobs map, filter pins, zoom to the matches, and highlight them. Use for "jobs in Dana Point", "show scheduled jobs", "jobs over 20 thousand", or any request to see jobs on the map. Then describe the mapped jobs in the same order returned.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City such as Dana Point or San Clemente' },
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
          limit: { type: 'integer', description: 'Max jobs (1–12)', default: 8 },
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
        'List employees on the rolodex who have a mobile number. Use before sending a text if the name is unclear.',
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
];

function buildSystemPrompt(voice = false) {
  const voiceLines = voice
    ? [
        'You are Liminality, a short shop-floor voice. Plain and useful. No banter, no feelings, no “I know you are upset.”',
        'Answer in one short sentence. If you used show_jobs_on_map, name at most three jobs: customer or job and city only. Skip amounts, ids, markdown, and filler.',
        'If send_customer_info_text sent, confirm who received which customer.',
        'If the tool still returns several people, ask once. If they say "the user" or "the contact", call the tool again with employeeKind set. Do not keep asking the same question.',
        'They already said your name. Follow-ups may be just "the user", "Jake", or a job name. Use history. Do not tell them to repeat the whole command.',
        '',
      ]
    : [];
  return [
    'You are Paarth Help, an in-app assistant for the Paarth operations web app.',
    'You only help with using this application. Be concise and practical.',
    'Never ask the user for passwords or API keys. Never fabricate customer or financial data.',
    'Use tools when the user needs live data from their organization or when they want to jump to a page.',
    'After navigate_user succeeds, briefly confirm where you sent them.',
    '',
    ...voiceLines,
    'Data tools — use these for operational questions:',
    '- get_recent_payments: customer payments marked received (job payment schedule)',
    '- get_recent_deposits: CRM deposits, linked bank deposits, and bank register inflows',
    '- search_job_notes: job modal notes and crew notes (materials to order, supplies, reminders)',
    '- get_job_details: one job\'s notes, payment schedule, and timeline (use jobId from search)',
    '- global_search: find a customer or job by name before get_job_details',
    '- search_jobs: jobs by city, street, customer, or title as a list',
    '- show_jobs_on_map: open the dashboard map, filter pins, zoom, and highlight ("jobs in Dana Point")',
    '- get_upcoming_schedule: appointments and jobs coming up on the calendar',
    '- send_customer_info_text: text a customer card to an employee on the rolodex ("send Hammer to Jake")',
    '- list_sms_employees: rolodex names that can receive texts',
    '',
    'For "send [customer] to [employee]", call send_customer_info_text. Do not invent a phone number. Do not send custom message bodies — only the customer card.',
    'For "materials to order" or similar, call search_job_notes with keywords like order, material, supply, hardware, cabinet, laminate.',
    'For "most recent payment" or "most recent deposit", call the matching recent-* tool and answer with amount, date, customer/job from the results only.',
    'For "jobs in [city]", "show me scheduled jobs on the map", or amount/stage map filters, call show_jobs_on_map. Do not only search_jobs when they asked to see the map or where the jobs are.',
    'For "who is coming up" or calendar questions, call get_upcoming_schedule.',
    'When deposit sources differ (CRM vs bank), say which is most recent by date.',
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
                toolContent = await fetchRecentDeposits({ tenantId, limit: args.limit });
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
              }
            } else if (fn.name === 'get_current_user_context') {
              const role = req.user?.role || 'unknown';
              toolContent = {
                name: req.user?.name,
                role,
                isAdmin: role === 'super_admin' || role === 'admin',
                isSuperAdmin: role === 'super_admin',
              };
            } else if (fn.name === 'navigate_user') {
              const safe = sanitizeNavigatePath(args.path, req.user?.role);
              if (safe) {
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
              }
            } else if (fn.name === 'show_jobs_on_map') {
              if (!tenantId) {
                toolContent = { error: 'No organization context for this account.' };
              } else {
                const mapResult = await showJobsOnMap({
                  city: args.city,
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
                  jobs: mapResult.jobs,
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
        }
        continue;
      }

      const reply = typeof msg.content === 'string' ? msg.content.trim() : '';
      return res.json({
        reply: reply || 'Done.',
        actions: clientActions.length ? clientActions : undefined,
      });
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

module.exports = {
  runAssistantChat,
};
