/**
 * ZenEdu webhook receiver — Stage 2 (append + UTM enrichment).
 *
 * Two-phase flow because ZenEdu populates `subscriber.utm_tags` only AFTER
 * the customer opens the Telegram bot post-purchase:
 *
 *   1. order.status.changed (paid) → append row to "Sales" with the order
 *      data we have at payment time. UTM columns stay empty, email goes
 *      into hidden col O for later correlation.
 *
 *   2. product.subscriber.added → find the latest un-enriched row matching
 *      the subscriber email, then patch columns C (Telegram), D (Имя),
 *      I-N (UTM + Источник). subscriber.added / subscriber.contact.created
 *      carry the same data and are skipped to avoid double-processing.
 *
 * Other responsibilities:
 *   - Validate shared secret (header OR ?token=...; timing-safe compare).
 *   - Filter: only botId 4475 (Kukharchuk presets).
 *   - Skip webhook.test and irrelevant events with 200 OK.
 *
 * Auth to Google: JWT signed with the service-account private key
 * (no npm deps — uses node:crypto + global fetch).
 *
 * Required env vars on Vercel:
 *   ZENEDU_WEBHOOK_SECRET            shared secret matching the ?token=... value
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL     SA client_email
 *   GOOGLE_SERVICE_ACCOUNT_KEY       SA private_key (PEM, with literal \n or real newlines)
 *   GOOGLE_SHEETS_ID                 target spreadsheet ID
 *   GOOGLE_SHEETS_TAB_NAME           target tab name (e.g. "Sales")
 */
'use strict';

const crypto = require('crypto');

const KUKHARCHUK_BOT_ID = 4475;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (e) {
    return false;
  }
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(saEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: saEmail,
    scope: SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const signingInput = `${header}.${claim}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Google token response missing access_token');
  }
  return json.access_token;
}

async function appendRowToSheet(sheetId, tab, row, accessToken) {
  const range = encodeURIComponent(`${tab}!A:O`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [row] })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets append failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function readSheet(sheetId, tab, accessToken) {
  const range = encodeURIComponent(`${tab}!A:O`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets read failed ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.values || [];
}

async function batchUpdateSheet(sheetId, accessToken, updates) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets batchUpdate failed ${res.status}: ${text}`);
  }
  return res.json();
}

function extractUtm(tags) {
  // Zenedu may send subscriber.utm_tags as array of {key,value} or {name,value}
  // or as a flat object. Be lenient.
  const out = {};
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (!t || typeof t !== 'object') continue;
      const k = String(t.key || t.name || '').toLowerCase().trim();
      const v = t.value != null ? String(t.value) : '';
      if (k.startsWith('utm_')) out[k] = v;
    }
  } else if (tags && typeof tags === 'object') {
    for (const [k, v] of Object.entries(tags)) {
      const key = String(k).toLowerCase().trim();
      if (key.startsWith('utm_')) out[key] = v != null ? String(v) : '';
    }
  }
  return out;
}

function buildRow(payload) {
  const d = payload.data || {};
  const sub = d.subscriber || {};

  const utm = extractUtm(sub.utm_tags);
  const fullName = [sub.first_name, sub.last_name].filter(Boolean).join(' ').trim();
  const displayName = fullName || d.email || '';
  const telegram = sub.username ? '@' + sub.username : '';
  const source = utm.utm_source || 'Direct';

  // Column order matches headers in row 1 of the "Sales" tab.
  // Column O (email) is a service column used to correlate enrichment from
  // subsequent product.subscriber.added events. May be hidden in the UI.
  return [
    d.status_changed_at || payload.timestamp || '',  // A: Дата оплаты
    d.uuid || '',                                    // B: UUID заказа
    telegram,                                        // C: Telegram
    displayName,                                     // D: Имя
    d.offer_name || '',                              // E: Тариф
    d.price ?? '',                                   // F: Сумма
    d.currency || '',                                // G: Валюта
    d.payment_system_name || '',                     // H: Платёжная система
    utm.utm_source || '',                            // I: utm_source
    utm.utm_medium || '',                            // J: utm_medium
    utm.utm_campaign || '',                          // K: utm_campaign
    utm.utm_term || '',                              // L: utm_term
    utm.utm_content || '',                           // M: utm_content
    source,                                          // N: Источник
    d.email || ''                                    // O: email (correlation key)
  ];
}

// Locate the latest row whose email matches and whose UTM is still empty,
// and patch it with Telegram, name, UTM, and Источник from the subscriber event.
async function enrichRowFromSubscriber(sheetId, tab, payload, accessToken) {
  const d = payload.data || {};
  const email = (d.email || '').trim();
  if (!email) {
    console.log('[zenedu-webhook] enrich: skipping — no email on subscriber');
    return { enriched: false, reason: 'no-email' };
  }

  const rows = await readSheet(sheetId, tab, accessToken);

  // Search bottom-up (skip header row at index 0) for: matching email in col O (idx 14)
  // AND empty utm_source in col I (idx 8) → most recent un-enriched row wins.
  let targetIdx = -1;
  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i] || [];
    const rowEmail = String(row[14] || '').toLowerCase().trim();
    const rowUtmSrc = String(row[8] || '').trim();
    if (rowEmail === email.toLowerCase() && !rowUtmSrc) {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx === -1) {
    console.log('[zenedu-webhook] enrich: no matching un-enriched row for email', email);
    return { enriched: false, reason: 'no-match' };
  }

  const sheetRow = targetIdx + 1; // 1-based for A1 notation
  const utm = extractUtm(d.utm_tags);
  const fullName = [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
  const displayName = fullName || email;
  const telegram = d.username ? '@' + d.username : '';
  const source = utm.utm_source || 'Direct';

  await batchUpdateSheet(sheetId, accessToken, [
    { range: `${tab}!C${sheetRow}:D${sheetRow}`, values: [[telegram, displayName]] },
    { range: `${tab}!I${sheetRow}:N${sheetRow}`, values: [[
      utm.utm_source || '',
      utm.utm_medium || '',
      utm.utm_campaign || '',
      utm.utm_term || '',
      utm.utm_content || '',
      source
    ]] }
  ]);

  console.log('[zenedu-webhook] enrich: updated row', { sheetRow, email, utm });
  return { enriched: true, sheetRow };
}

// Read Google credentials + sheet identifiers from env, exchange JWT for an
// access token, and return everything we need to talk to Sheets. If anything
// is missing, send a 500 response and return { accessToken: null } so the
// caller can early-return.
async function loadSheetsContext(res) {
  const saEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n').trim();
  const sheetId = (process.env.GOOGLE_SHEETS_ID || '').trim();
  const sheetTab = (process.env.GOOGLE_SHEETS_TAB_NAME || 'Sales').trim();

  if (!saEmail || !privateKey || !sheetId) {
    console.error('[zenedu-webhook] Missing Google env vars', {
      hasEmail: !!saEmail, hasKey: !!privateKey, hasSheetId: !!sheetId
    });
    res.status(500).json({ error: 'Server misconfigured: missing Google credentials' });
    return { accessToken: null };
  }

  const accessToken = await getAccessToken(saEmail, privateKey);
  return { accessToken, sheetId, sheetTab };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const SECRET = (process.env.ZENEDU_WEBHOOK_SECRET || '').trim();
  if (!SECRET) {
    console.error('[zenedu-webhook] Missing env var ZENEDU_WEBHOOK_SECRET');
    res.status(500).json({ error: 'Server misconfigured: missing webhook secret' });
    return;
  }

  const headerToken = (req.headers['x-webhook-token'] || '').trim();
  const authHeader = (req.headers['authorization'] || '').trim();
  const authToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const queryToken = (req.query && typeof req.query.token === 'string') ? req.query.token.trim() : '';
  const provided = headerToken || authToken || queryToken;

  if (!provided || !safeEqual(provided, SECRET)) {
    console.warn('[zenedu-webhook] Unauthorized', {
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
    });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { /* keep raw */ }
  }
  if (!body || typeof body !== 'object') {
    console.warn('[zenedu-webhook] Empty or non-JSON body — acknowledging anyway');
    res.status(200).json({ ok: true, skipped: 'empty-body' });
    return;
  }

  const event = body.event;
  const data = body.data || {};
  const botId = data.botId;
  const status = data.status;

  // Skip Zenedu test pings — acknowledge so they show green in dashboard
  if (event === 'webhook.test') {
    console.log('[zenedu-webhook] Test ping acknowledged');
    res.status(200).json({ ok: true, skipped: 'webhook.test' });
    return;
  }

  // subscriber.added fires together with product.subscriber.added and carries
  // the same data; we use only the product event to avoid double enrichment.
  if (event === 'subscriber.added' || event === 'subscriber.contact.created') {
    res.status(200).json({ ok: true, skipped: `event:${event}` });
    return;
  }

  // Handle subscriber enrichment: filter bot, then patch existing Sheet row.
  if (event === 'product.subscriber.added') {
    if (botId !== KUKHARCHUK_BOT_ID) {
      console.log('[zenedu-webhook] enrich: skipping foreign bot', { botId });
      res.status(200).json({ ok: true, skipped: `bot:${botId}` });
      return;
    }
    try {
      const { accessToken, sheetId, sheetTab } = await loadSheetsContext(res);
      if (!accessToken) return; // loadSheetsContext already responded
      const result = await enrichRowFromSubscriber(sheetId, sheetTab, body, accessToken);
      res.status(200).json({ ok: true, ...result });
    } catch (e) {
      console.error('[zenedu-webhook] enrich error', e.message, e.stack);
      // Return 500 so Zenedu retries — losing UTM enrichment is recoverable but unwanted.
      res.status(500).json({ error: 'Enrich failed', detail: e.message });
    }
    return;
  }

  // Skip events we don't care about (order.created etc.)
  if (event !== 'order.status.changed') {
    console.log('[zenedu-webhook] Skipping unsupported event:', event);
    res.status(200).json({ ok: true, skipped: `event:${event}` });
    return;
  }

  // Filter by bot — silently accept other bots so Zenedu doesn't retry
  if (botId !== KUKHARCHUK_BOT_ID) {
    console.log('[zenedu-webhook] Skipping foreign botId', { botId, offer: data.offer_name });
    res.status(200).json({ ok: true, skipped: `bot:${botId}` });
    return;
  }

  // Only record paid orders
  if (status !== 'paid') {
    console.log('[zenedu-webhook] Skipping non-paid status', { status, orderId: data.id });
    res.status(200).json({ ok: true, skipped: `status:${status}` });
    return;
  }

  // ----- All filters passed: append to Sheet -----
  try {
    const { accessToken, sheetId, sheetTab } = await loadSheetsContext(res);
    if (!accessToken) return;
    const row = buildRow(body);
    const result = await appendRowToSheet(sheetId, sheetTab, row, accessToken);
    console.log('[zenedu-webhook] Row appended', {
      orderId: data.id,
      offer: data.offer_name,
      email: data.email,
      updatedRange: result.updates?.updatedRange
    });
    res.status(200).json({ ok: true, appended: true, range: result.updates?.updatedRange });
  } catch (e) {
    console.error('[zenedu-webhook] Sheets append error', e.message, e.stack);
    // Return 500 so Zenedu retries — better to have a duplicate than to lose a sale.
    res.status(500).json({ error: 'Failed to append to sheet', detail: e.message });
  }
};
