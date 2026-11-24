const { buildWorksheetResult } = require('../utils/worksheetDraft');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const READ_TIMEOUT_MS = 90000;

const PROMPT = `You are reading a job worksheet for San Clemente Woodworking (SCWW), a stair and railing shop. Image 1 is the whole page. Any other images are zoomed parts of the same page. Use them to read small handwriting.

The page has printed parts and handwritten parts.
- Printed parts belong to the shop. Never use them as customer details: the blue header bar with "Joe Toombs 951-491-1137", "Mystairguy@gmail.com", and "San Clemente Woodworking", the round logo, the website, "CA LIC #", "* Does not include paint/stain", "Accepted", and the row and column labels of the material grid.
- Handwritten parts are the customer details: the Date and Ref lines, HM (home address), Email, Ph, marks in checkboxes, entries in the material grid, the scope lines under "Demo, tear out, haul away", the total beside "Ttl", and notes.

Copy handwriting as written. Do not complete or correct it. If an email is written without its ending, such as "name@ AOL" with no ".com", return "name@aol" and mark it unclear.

Every field has text, unclear, and reason. Set unclear to true when a character could be read more than one way, the value looks cut off or incomplete, or you inferred part of it. Give a short reason that names the other possible reading, such as "middle group 391 or 341". Leave text "" when the field is blank or unreadable.

Fields:
- customerName: the homeowner. If only a first name is written and the email shows the last name, combine them and mark unclear with the reason.
- customerPhone: the first phone on the Ph line.
- customerEmail: the handwritten email.
- street, city, state, zip: from the HM line. The city is often written at the end of the street line. Fill state and zip only when written.
- ref: the handwriting after "Ref".
- worksheetDate: the handwritten date.
- total: the handwritten total beside "Ttl", as written, such as "11,900".
- customerType: which of the Contractor or Customer boxes is checked, or unknown.
- options: every printed checkbox (Over the Post, Post To Post, Contractor, Customer, and any others) with checked true or false.
- materials: each grid row with handwriting. item is the row label. wood is the name of the column that holds a mark, such as White Oak or Maple, never the mark itself. finish is the P.C. entry, such as Blk. quantity is the Qty entry. note is the other handwriting on that row, including words just past the edge of the grid.
- scopeLines: the handwritten scope lines in order, joined across line breaks, such as "Install 30 ft white oak rail system w/ iron balusters as described".
- scopeTitle: two to six words for the work, such as "White oak rail and iron balusters".
- otherContacts: any other name, phone, or email beyond the main customer, such as a second phone line. Do not repeat the main customer. Put labels like "H." in note.
- notes: other handwriting worth keeping. Leave out numbers and arrows on the stair sketch.
- pageTurn: how the image must be turned so the text reads normally.
- isScwwWorksheet: true when the page is the SCWW worksheet form.

If the page is a different form or a photo, fill what it shows the same way.`;

const FIELD = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'unclear', 'reason'],
  properties: {
    text: { type: 'string' },
    unclear: { type: 'boolean' },
    reason: { type: 'string' },
  },
};

const WORKSHEET_SCHEMA = {
  name: 'worksheet',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'pageTurn',
      'isScwwWorksheet',
      'customerName',
      'customerPhone',
      'customerEmail',
      'street',
      'city',
      'state',
      'zip',
      'ref',
      'worksheetDate',
      'total',
      'customerType',
      'options',
      'materials',
      'scopeLines',
      'scopeTitle',
      'otherContacts',
      'notes',
    ],
    properties: {
      pageTurn: { type: 'string', enum: ['upright', 'turn_clockwise', 'turn_counterclockwise', 'upside_down'] },
      isScwwWorksheet: { type: 'boolean' },
      customerName: FIELD,
      customerPhone: FIELD,
      customerEmail: FIELD,
      street: FIELD,
      city: FIELD,
      state: FIELD,
      zip: FIELD,
      ref: FIELD,
      worksheetDate: FIELD,
      total: FIELD,
      customerType: { type: 'string', enum: ['customer', 'contractor', 'unknown'] },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'checked'],
          properties: { label: { type: 'string' }, checked: { type: 'boolean' } },
        },
      },
      materials: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['item', 'wood', 'finish', 'quantity', 'note'],
          properties: {
            item: { type: 'string' },
            wood: { type: 'string' },
            finish: { type: 'string' },
            quantity: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
      scopeLines: { type: 'array', items: { type: 'string' } },
      scopeTitle: { type: 'string' },
      otherContacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'phone', 'email', 'note', 'unclear', 'reason'],
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            note: { type: 'string' },
            unclear: { type: 'boolean' },
            reason: { type: 'string' },
          },
        },
      },
      notes: { type: 'array', items: { type: 'string' } },
    },
  },
};

function openaiKey() {
  return process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENNAI_API_KEY || '';
}

function readerModels() {
  const primary = (process.env.OPENAI_WORKSHEET_MODEL || 'gpt-5.4').trim() || 'gpt-5.4';
  const raw = process.env.OPENAI_WORKSHEET_CHECK_MODEL;
  const check = raw == null ? 'gpt-5.5' : raw.trim();
  return { primary, check: check && check !== 'off' ? check : '' };
}

function modelOptions(model) {
  if (/^(gpt-5|o\d)/.test(model)) {
    const effort = (process.env.OPENAI_WORKSHEET_REASONING || 'low').trim() || 'low';
    return { max_completion_tokens: 6000, reasoning_effort: effort };
  }
  return { max_tokens: 2500, temperature: 0 };
}

function imageParts(images) {
  return images.map((image) => ({
    type: 'image_url',
    image_url: { url: `data:${image.mime};base64,${image.buffer.toString('base64')}`, detail: 'high' },
  }));
}

async function readWithModel({ model, images, filename, signal }) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey()}`,
    },
    signal,
    body: JSON.stringify({
      model,
      ...modelOptions(model),
      response_format: { type: 'json_schema', json_schema: WORKSHEET_SCHEMA },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${PROMPT}\n\nThe file was named "${String(filename || '').slice(0, 180)}". Treat the name as a hint only.`,
            },
            ...imageParts(images),
          ],
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Worksheet reader failed (${model})`);
    err.status = res.status;
    err.detail = text.slice(0, 300);
    throw err;
  }
  const content = JSON.parse(text)?.choices?.[0]?.message?.content || '';
  return JSON.parse(content);
}

async function readWorksheetImages({ images, filename }) {
  if (!openaiKey()) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const { primary, check } = readerModels();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const [first, second] = await Promise.allSettled([
      readWithModel({ model: primary, images, filename, signal: controller.signal }),
      check ? readWithModel({ model: check, images, filename, signal: controller.signal }) : Promise.resolve(null),
    ]);
    if (first.status === 'rejected') {
      if (second.status === 'fulfilled' && second.value) {
        return buildWorksheetResult(second.value, null, filename);
      }
      throw first.reason;
    }
    if (second.status === 'rejected') {
      console.warn('worksheet check read failed', second.reason?.status || second.reason?.message);
    }
    return buildWorksheetResult(first.value, second.status === 'fulfilled' ? second.value : null, filename);
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error('Worksheet reading timed out');
      err.code = 'TIMEOUT';
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function previewWorksheet(req, res) {
  try {
    const page = req.files?.page?.[0];
    if (!page?.buffer?.length) {
      return res.status(400).json({ error: 'Drop a worksheet PDF or photo' });
    }
    const zoom = (req.files?.zoom || []).filter((file) => file?.buffer?.length);
    const images = [page, ...zoom].map((file) => ({ buffer: file.buffer, mime: file.mimetype }));
    const result = await readWorksheetImages({
      images,
      filename: req.body?.filename || page.originalname,
    });
    return res.json(result);
  } catch (error) {
    if (error.code === 'NO_API_KEY') {
      return res.status(503).json({ error: 'Worksheet reader is not set up on the server yet' });
    }
    if (error.code === 'TIMEOUT') {
      return res.status(504).json({ error: 'Reading the worksheet took too long' });
    }
    console.error('worksheet preview failed', error.status || '', error.detail || error.message);
    return res.status(502).json({ error: 'Could not read that worksheet' });
  }
}

module.exports = { previewWorksheet, readWorksheetImages, WORKSHEET_SCHEMA };
