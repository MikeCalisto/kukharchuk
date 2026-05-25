/**
 * ZenEdu webhook receiver — Stage 1 (append to Google Sheets).
 *
 * Responsibilities:
 *   1. Accept POST from ZenEdu's `order.status.changed` webhook.
 *   2. Validate shared secret (header OR ?token=...; timing-safe compare).
 *   3. Filter: only botId 4475 (Kukharchuk presets), only paid orders.
 *   4. Skip webhook.test and other non-order events with 200 OK.
 *   5. Append a row to the "Sales" tab of the configured Google Sheet.
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
  const range = encodeURIComponent(`${tab}!A:N`);
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
    source                                           // N: Источник
  ];
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

  // Skip events we don't care about
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
  const saEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n').trim();
  const sheetId = (process.env.GOOGLE_SHEETS_ID || '').trim();
  const sheetTab = (process.env.GOOGLE_SHEETS_TAB_NAME || 'Sales').trim();

  if (!saEmail || !privateKey || !sheetId) {
    console.error('[zenedu-webhook] Missing Google env vars', {
      hasEmail: !!saEmail, hasKey: !!privateKey, hasSheetId: !!sheetId
    });
    res.status(500).json({ error: 'Server misconfigured: missing Google credentials' });
    return;
  }

  try {
    const accessToken = await getAccessToken(saEmail, privateKey);
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
