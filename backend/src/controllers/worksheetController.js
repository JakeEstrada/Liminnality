const { sanitizeWorksheetDraft } = require('../utils/worksheetDraft');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const PROMPT = `Read this San Clemente Woodworking stair worksheet. The photo may be sideways or upside down. Read the handwritten customer block, not the printed shop header.

Ignore Joe Toombs, 951-491-1137, Mystairguy@gmail.com, San Clemente Woodworking, and the license number. Those belong to the shop.

Return JSON only with these keys:
- title: short job name. Prefer the street address without the city, such as "4632 E Bradford". If there is no street, use the customer name.
- customerName: the homeowner. Not the shop, not the person on the Ref line.
- customerPhone: the customer's main phone.
- customerEmail: the customer's email.
- street, city, state, zip: the job address. The handwritten line next to HM is the street, and the city is often at the end of that same line.
- valueEstimated: the job total, usually written next to Ttl. A number, or null. Do not use quantities from the material grid.
- source: one of referral, vehicle_advertisement, yelp, instagram, facebook, website, repeat, other. Use referral when the Ref line names a person or company.
- referralCompany: the Ref line, or "".
- extraNote: any second phone or second name that did not fit the main fields, or "".

Leave a field as "" when you cannot read it. Do not guess.`;

function worksheetModel() {
  return (process.env.OPENAI_WORKSHEET_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
}

function parseModelJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  return JSON.parse(body);
}

async function readWorksheetImage({ buffer, mime, filename }) {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENNAI_API_KEY;
  if (!key) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: worksheetModel(),
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${PROMPT}\n\nFile name, which is only a hint: ${String(filename || '').slice(0, 180)}`,
              },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
      }),
    });
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

  const text = await res.text();
  if (!res.ok) {
    const err = new Error('Worksheet reader failed');
    err.status = res.status;
    throw err;
  }
  const payload = JSON.parse(text);
  const content = payload?.choices?.[0]?.message?.content || '';
  return sanitizeWorksheetDraft(parseModelJson(content), filename);
}

async function previewWorksheet(req, res) {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Drop a worksheet PDF or photo' });
    }
    const draft = await readWorksheetImage({
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      filename: req.body?.filename || req.file.originalname,
    });
    return res.json({ draft });
  } catch (error) {
    if (error.code === 'NO_API_KEY') {
      return res.status(503).json({ error: 'Worksheet reader is not set up on the server yet' });
    }
    if (error.code === 'TIMEOUT') {
      return res.status(504).json({ error: 'Reading the worksheet took too long' });
    }
    console.error('worksheet preview failed', error.status || error.message);
    return res.status(502).json({ error: 'Could not read that worksheet' });
  }
}

module.exports = { previewWorksheet, readWorksheetImage };
