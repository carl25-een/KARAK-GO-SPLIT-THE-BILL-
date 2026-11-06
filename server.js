// server.js — Karak & Go Split-the-Bill server.
// Zero-dependency Node.js (built-in http module only). Run: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { load, save, uid } = require('./lib/store');
const { computeBill } = require('./lib/calc');
const mpesa = require('./lib/mpesa');

// ---- tiny .env loader (no dependency) ----
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    });
  }
} catch (e) { /* .env is optional */ }

const PORT = process.env.PORT || 3000;
const STAFF_PIN = process.env.STAFF_PIN || ''; // when set, menu edits + bill deletion need it
const PUBLIC_DIR = path.join(__dirname, 'public');

const store = load();

// ---------- helpers ----------
function send(res, code, body, type) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* already gone */ } return; }
  const isJson = !type || type === 'application/json';
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type || 'application/json' });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function staffOnly(req, res) {
  if (!STAFF_PIN) return true;
  if (req.headers['x-staff-pin'] === STAFF_PIN) return true;
  send(res, 401, { error: 'Staff PIN required' });
  return false;
}
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : (d || ''));

function sanitiseBill(input, existing) {
  const b = existing || {
    id: uid('b'), items: [], splitMode: 'equal', percentages: {},
    tipPercent: 0, taxPercent: 0, discount: { type: 'percent', value: 0 },
    payerId: null, paidBy: {}, status: 'open', createdAt: new Date().toISOString(), closedAt: null,
  };
  if (input.occasion !== undefined) b.occasion = str(input.occasion);
  if (input.table !== undefined) b.table = str(input.table);
  if (Array.isArray(input.people)) {
    b.people = input.people
      .map((p) => ({ id: str(p.id, uid('p')), name: str(p.name, 'Guest') }))
      .slice(0, 30);
  }
  if (!Array.isArray(b.people)) b.people = [];
  const personIds = new Set(b.people.map((p) => p.id));
  if (Array.isArray(input.items)) {
    b.items = input.items.map((it) => ({
      id: str(it.id, uid('i')),
      menuItemId: it.menuItemId || null,
      name: str(it.name, 'Item'),
      price: Math.max(0, num(it.price, 0)),
      qty: Math.max(1, Math.round(num(it.qty, 1))),
      assignedTo: Array.isArray(it.assignedTo) ? it.assignedTo.filter((id) => personIds.has(id)) : [],
    })).slice(0, 200);
  }
  if (!Array.isArray(b.items)) b.items = [];
  if (['equal', 'item', 'percent'].includes(input.splitMode)) b.splitMode = input.splitMode;
  if (input.percentages && typeof input.percentages === 'object') {
    b.percentages = {};
    Object.keys(input.percentages).forEach((k) => { if (personIds.has(k)) b.percentages[k] = Math.max(0, num(input.percentages[k], 0)); });
  }
  if (input.tipPercent !== undefined) b.tipPercent = Math.max(0, num(input.tipPercent, 0));
  if (input.taxPercent !== undefined) b.taxPercent = Math.max(0, num(input.taxPercent, 0));
  if (input.discount && typeof input.discount === 'object') {
    b.discount = {
      type: input.discount.type === 'amount' ? 'amount' : 'percent',
      value: Math.max(0, num(input.discount.value, 0)),
    };
  }
  if (input.payerId !== undefined) b.payerId = personIds.has(input.payerId) ? input.payerId : null;
  if (input.paidBy && typeof input.paidBy === 'object') {
    b.paidBy = {};
    Object.keys(input.paidBy).forEach((k) => { if (personIds.has(k)) b.paidBy[k] = Boolean(input.paidBy[k]); });
  }
  return b;
}

function billSummary(b) {
  const c = computeBill(b);
  return {
    id: b.id, occasion: b.occasion, table: b.table, status: b.status,
    createdAt: b.createdAt, closedAt: b.closedAt,
    peopleCount: (b.people || []).length, grandTotal: c.grandTotal,
  };
}

// ---------- server ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  try {
    // ----- API -----
    if (p === '/api/config' && method === 'GET') {
      return send(res, 200, { staffPinRequired: Boolean(STAFF_PIN), mpesaEnabled: mpesa.mpesaEnabled() });
    }

    if (p === '/api/menu' && method === 'GET') {
      return send(res, 200, { items: store.menuItems });
    }
    if (p === '/api/menu' && method === 'POST') {
      if (!staffOnly(req, res)) return;
      const body = await readBody(req);
      const item = {
        id: uid('m'),
        name: str(body.name, 'New item'),
        price: Math.max(0, num(body.price, 0)),
        category: str(body.category, 'Extras'),
      };
      store.menuItems.push(item); save();
      return send(res, 201, item);
    }
    const menuMatch = p.match(/^\/api\/menu\/([\w-]+)$/);
    if (menuMatch && method === 'PUT') {
      if (!staffOnly(req, res)) return;
      const item = store.menuItems.find((m) => m.id === menuMatch[1]);
      if (!item) return send(res, 404, { error: 'Menu item not found' });
      const body = await readBody(req);
      if (body.name !== undefined) item.name = str(body.name, item.name);
      if (body.price !== undefined) item.price = Math.max(0, num(body.price, item.price));
      if (body.category !== undefined) item.category = str(body.category, item.category);
      save();
      return send(res, 200, item);
    }
    if (menuMatch && method === 'DELETE') {
      if (!staffOnly(req, res)) return;
      const i = store.menuItems.findIndex((m) => m.id === menuMatch[1]);
      if (i < 0) return send(res, 404, { error: 'Menu item not found' });
      store.menuItems.splice(i, 1); save();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/bills' && method === 'GET') {
      return send(res, 200, { bills: store.bills.map(billSummary) });
    }
    if (p === '/api/bills' && method === 'POST') {
      const body = await readBody(req);
      const names = Array.isArray(body.people) ? body.people : [];
      const bill = sanitiseBill({
        occasion: body.occasion, table: body.table,
        people: names.map((nm) => ({ name: typeof nm === 'string' ? nm : (nm && nm.name) })),
      });
      store.bills.unshift(bill); save();
      return send(res, 201, { bill, computed: computeBill(bill) });
    }
    const billMatch = p.match(/^\/api\/bills\/([\w-]+)$/);
    if (billMatch && method === 'GET') {
      const bill = store.bills.find((b) => b.id === billMatch[1]);
      if (!bill) return send(res, 404, { error: 'Bill not found' });
      return send(res, 200, { bill, computed: computeBill(bill) });
    }
    if (billMatch && method === 'PUT') {
      const bill = store.bills.find((b) => b.id === billMatch[1]);
      if (!bill) return send(res, 404, { error: 'Bill not found' });
      const body = await readBody(req);
      sanitiseBill(body, bill); save();
      return send(res, 200, { bill, computed: computeBill(bill) });
    }
    if (billMatch && method === 'DELETE') {
      if (!staffOnly(req, res)) return;
      const i = store.bills.findIndex((b) => b.id === billMatch[1]);
      if (i < 0) return send(res, 404, { error: 'Bill not found' });
      store.bills.splice(i, 1); save();
      return send(res, 200, { ok: true });
    }
    const closeMatch = p.match(/^\/api\/bills\/([\w-]+)\/(close|reopen)$/);
    if (closeMatch && method === 'POST') {
      const bill = store.bills.find((b) => b.id === closeMatch[1]);
      if (!bill) return send(res, 404, { error: 'Bill not found' });
      if (closeMatch[2] === 'close') { bill.status = 'settled'; bill.closedAt = new Date().toISOString(); }
      else { bill.status = 'open'; bill.closedAt = null; }
      save();
      return send(res, 200, { bill, computed: computeBill(bill) });
    }
    // ----- M-Pesa (Daraja STK Push) -----
    const payMatch = p.match(/^\/api\/bills\/([\w-]+)\/pay\/([\w-]+)$/);
    if (payMatch && method === 'POST') {
      if (!mpesa.mpesaEnabled()) return send(res, 503, { error: 'M-Pesa is not set up on this server yet' });
      const bill = store.bills.find((b) => b.id === payMatch[1]);
      if (!bill) return send(res, 404, { error: 'Bill not found' });
      if (bill.status !== 'open') return send(res, 400, { error: 'This bill is already settled' });
      const person = (bill.people || []).find((x) => x.id === payMatch[2]);
      if (!person) return send(res, 404, { error: 'Person not found' });
      if (bill.paidBy && bill.paidBy[person.id]) return send(res, 400, { error: 'Already marked as paid' });
      const body = await readBody(req);
      const phone = mpesa.normalizePhone(str(body.phone));
      if (!phone) return send(res, 400, { error: 'Enter a valid M-Pesa phone number (e.g. 0712 345 678)' });
      const share = computeBill(bill).perPerson.find((x) => x.personId === person.id);
      // Daraja charges whole shillings only; round the exact share.
      const amount = share ? Math.round(share.total) : 0;
      if (!amount || amount < 1) return send(res, 400, { error: 'Nothing to pay for this person' });
      bill.payments = bill.payments || {};
      const existing = bill.payments[person.id];
      if (existing && existing.status === 'pending' && Date.now() - new Date(existing.requestedAt).getTime() < 120000) {
        return send(res, 409, { error: 'A payment prompt is already on its way to that phone — enter the PIN, or wait a moment and retry' });
      }
      try {
        const r = await mpesa.stkPush({
          phone,
          amount,
          accountReference: 'KarakGo',
          description: `Bill share - ${person.name}`,
        });
        bill.payments[person.id] = {
          checkoutRequestId: r.checkoutRequestId, merchantRequestId: r.merchantRequestId,
          phone, amount, status: 'pending',
          requestedAt: new Date().toISOString(), completedAt: null, receipt: null, resultDesc: null,
        };
        save();
        return send(res, 200, { ok: true, amount, checkoutRequestId: r.checkoutRequestId });
      } catch (e) {
        return send(res, 502, { error: 'M-Pesa could not be reached: ' + e.message });
      }
    }
    if (p === '/api/mpesa/callback' && method === 'POST') {
      const body = await readBody(req);
      const result = mpesa.parseCallback(body);
      // Always acknowledge with the shape Daraja expects, even for unknown
      // requests, so Safaricom does not keep retrying.
      if (result) {
        for (const bill of store.bills) {
          const entry = Object.entries(bill.payments || {}).find(([, pay]) => pay && pay.checkoutRequestId === result.checkoutRequestId);
          if (!entry) continue;
          const [personId, pay] = entry;
          pay.completedAt = new Date().toISOString();
          pay.resultDesc = result.resultDesc || null;
          if (result.resultCode === 0) {
            pay.status = 'success';
            pay.receipt = result.receipt || null;
            if (result.amount != null) pay.amount = result.amount;
            bill.paidBy = bill.paidBy || {};
            bill.paidBy[personId] = true;
          } else {
            pay.status = result.resultCode === 1032 ? 'cancelled' : 'failed';
          }
          save();
          break;
        }
      }
      return send(res, 200, { ResultCode: 0, ResultDesc: 'Accepted' });
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

    // ----- static + page routes (/ = intro page; /app and /bill/<id> = the app) -----
    let filePath = path.join(PUBLIC_DIR, p);
    if (p === '/') filePath = path.join(PUBLIC_DIR, 'intro.html');
    else if (p === '/app' || p.startsWith('/bill/')) filePath = path.join(PUBLIC_DIR, 'index.html');
    if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // unknown paths fall back to the SPA shell
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) return send(res, 500, 'Server error', 'text/plain');
          send(res, 200, html.toString(), 'text/html');
        });
        return;
      }
      send(res, 200, data.toString(), MIME[path.extname(filePath)] || 'application/octet-stream');
    });
  } catch (e) {
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Karak & Go Split-the-Bill running at http://localhost:${PORT}`);
  console.log(STAFF_PIN ? 'Staff PIN protection: ON' : 'Staff PIN protection: OFF (set STAFF_PIN to enable)');
  console.log(mpesa.mpesaEnabled()
    ? `M-Pesa: ON (${mpesa.ENV}, ${mpesa.API_BASE})`
    : 'M-Pesa: OFF (set MPESA_* variables to enable — see .env.example)');
});
