/**
 * ZenEdu webhook receiver — Stage 0 (log-only).
 *
 * Stage 0 responsibilities (this file):
 *   1. Accept POST requests from ZenEdu's `order.status.changed` webhook.
 *   2. Validate the shared secret (header OR query token; timing-safe compare).
 *   3. Log full request headers + body to Vercel function logs.
 *   4. Return 200 OK.
 *
 * Stage 1 (after we see real payload structure):
 *   - Parse fields, map to 14 Google Sheets columns, append row via googleapis.
 *   - Skip non-`paid` events with 200 OK (so ZenEdu doesn't retry).
 *
 * Vercel: served as a Node serverless function at /api/zenedu-webhook
 * (runtime config in vercel.json — maxDuration:30).
 */
'use strict';

const crypto = require('crypto');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  // Quick preflight courtesy
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
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

  // Look for secret in (a) X-Webhook-Token header, (b) Authorization: Bearer ..., (c) ?token=...
  const headerToken = (req.headers['x-webhook-token'] || '').trim();
  const authHeader = (req.headers['authorization'] || '').trim();
  const authToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const queryToken = (req.query && typeof req.query.token === 'string') ? req.query.token.trim() : '';

  const provided = headerToken || authToken || queryToken;
  if (!provided || !safeEqual(provided, SECRET)) {
    // Diagnostic fingerprints: SHA-256 first 8 hex chars — lets us compare without leaking secrets
    const fp = (s) => s ? crypto.createHash('sha256').update(s).digest('hex').slice(0, 8) : 'none';
    let parsedBody = req.body;
    if (typeof parsedBody === 'string') {
      try { parsedBody = JSON.parse(parsedBody); } catch (e) { /* leave raw */ }
    }
    console.warn('[zenedu-webhook] Unauthorized request', {
      hasHeaderToken: !!headerToken,
      hasAuthHeader: !!authHeader,
      hasQueryToken: !!queryToken,
      providedLength: provided.length,
      expectedLength: SECRET.length,
      providedFp: fp(provided),
      expectedFp: fp(SECRET),
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
    });
    // Stage 0: temporarily log body even on 401 so we can capture ZenEdu's payload shape.
    // TODO: remove this once auth is sorted and Stage 1 mapping is in place.
    console.log('[zenedu-webhook] Unauthorized body (Stage 0 capture):', JSON.stringify(parsedBody, null, 2));
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Vercel auto-parses JSON when content-type is application/json; fallback for raw text
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { /* leave as string for log */ }
  }

  try {
    console.log('=== [zenedu-webhook] received ===');
    console.log('Time:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(body, null, 2));
    console.log('=================================');

    // Stage 0 — no DB / no Sheets. Just acknowledge.
    res.status(200).json({ ok: true, stage: 'log-only' });
  } catch (e) {
    console.error('[zenedu-webhook] handler error', e);
    res.status(500).json({ error: 'Internal error' });
  }
};
