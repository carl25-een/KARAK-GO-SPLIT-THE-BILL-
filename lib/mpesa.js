// lib/mpesa.js — Safaricom Daraja (M-Pesa) STK Push integration.
//
// Zero dependencies: Node's built-in https module only.
//
// All configuration comes from environment variables (see .env.example):
//   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET — from a Daraja app
//   MPESA_SHORTCODE   — the business shortcode (sandbox test: 174379)
//   MPESA_PASSKEY     — the Lipa Na M-Pesa passkey for that shortcode
//   MPESA_CALLBACK_URL— public URL Safaricom calls with the payment result,
//                       e.g. https://your-site.example/api/mpesa/callback
//   MPESA_ENV         — 'sandbox' (default) or 'production'
//   MPESA_API_BASE    — optional override of the Daraja base URL
//                       (used by the local end-to-end test stub)
//
// When the key variables are not all set, mpesaEnabled() is false and the
// rest of the app behaves exactly as before (manual "Paid" ticks).

const https = require('https');
const http = require('http');
const { URL } = require('url');

const ENV = (process.env.MPESA_ENV || 'sandbox').toLowerCase();
const API_BASE = process.env.MPESA_API_BASE
  || (ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || '';
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
const SHORTCODE = process.env.MPESA_SHORTCODE || '';
const PASSKEY = process.env.MPESA_PASSKEY || '';
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL || '';

function mpesaEnabled() {
  return Boolean(CONSUMER_KEY && CONSUMER_SECRET && SHORTCODE && PASSKEY && CALLBACK_URL);
}

// ---- small JSON-over-http(s) helper (https for Daraja, http allowed for
// a local test stub via MPESA_API_BASE) ----
function httpsJson(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const transport = u.protocol === 'http:' ? http : https;
    const data = body ? JSON.stringify(body) : null;
    const req = transport.request({
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(headers || {}),
      },
      timeout: 20000,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { /* leave null */ }
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Daraja request timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---- OAuth access token, cached until shortly before it expires ----
let tokenCache = { token: null, expiresAt: 0 };
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const basic = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await httpsJson('GET', `${API_BASE}/oauth/v1/generate?grant_type=client_credentials`, { Authorization: `Basic ${basic}` });
  if (res.status !== 200 || !res.body || !res.body.access_token) {
    throw new Error(`Daraja OAuth failed (HTTP ${res.status})`);
  }
  const ttlSec = Number(res.body.expires_in) || 3600;
  tokenCache = { token: res.body.access_token, expiresAt: Date.now() + Math.max(60, ttlSec - 60) * 1000 };
  return tokenCache.token;
}

// Daraja timestamps are YYYYMMDDHHmmss in East Africa Time.
function stkTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

// Accept 07…, 01…, +254…, 254… and bare 7…/1…; return 254… or null.
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let d = input.replace(/[\s+-]/g, '');
  if (/^0[17]\d{8}$/.test(d)) d = '254' + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) d = '254' + d;
  return /^254[17]\d{8}$/.test(d) ? d : null;
}

// Send an STK Push (Lipa Na M-Pesa Online) prompt to the payer's phone.
// amount must be a whole number of KSh (Daraja does not accept cents).
async function stkPush({ phone, amount, accountReference, description }) {
  const token = await getAccessToken();
  const timestamp = stkTimestamp();
  const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
  const res = await httpsJson('POST', `${API_BASE}/mpesa/stkpush/v1/processrequest`, { Authorization: `Bearer ${token}` }, {
    BusinessShortCode: SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: CALLBACK_URL,
    AccountReference: String(accountReference || 'KarakGo').slice(0, 12),
    TransactionDesc: String(description || 'Karak & Go bill share').slice(0, 100),
  });
  const b = res.body || {};
  if (res.status !== 200 || String(b.ResponseCode) !== '0') {
    throw new Error(b.ResponseDescription || b.errorMessage || `STK Push failed (HTTP ${res.status})`);
  }
  return { merchantRequestId: b.MerchantRequestID, checkoutRequestId: b.CheckoutRequestID };
}

// Parse a Daraja STK callback body into a flat result, or null if it is not
// an STK result callback.
function parseCallback(body) {
  const cb = body && body.Body && body.Body.stkCallback;
  if (!cb || !cb.CheckoutRequestID) return null;
  const meta = {};
  const items = cb.CallbackMetadata && Array.isArray(cb.CallbackMetadata.Item) ? cb.CallbackMetadata.Item : [];
  items.forEach((it) => { if (it && it.Name) meta[it.Name] = it.Value; });
  return {
    merchantRequestId: cb.MerchantRequestID || null,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: Number(cb.ResultCode),
    resultDesc: cb.ResultDesc || '',
    amount: meta.Amount != null ? Number(meta.Amount) : null,
    receipt: meta.MpesaReceiptNumber || null,
    phone: meta.PhoneNumber != null ? String(meta.PhoneNumber) : null,
  };
}

module.exports = { mpesaEnabled, normalizePhone, stkPush, parseCallback, API_BASE, ENV };
