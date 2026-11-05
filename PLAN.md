# PLAN — Matcha Café Split-the-Bill, Hosted System

This is the plan behind the standalone codebase in this folder: how the system is put together, who can do what, where it can live, and what to build next.

## 1. What it is

A single web app that a matcha café uses to split bills at the table:

1. Staff start a bill (occasion, table, names).
2. Items are added from the café menu (or as custom one-offs).
3. The bill is split equally, by item, or by percentage — with tip, tax and discount.
4. Each person sees their exact amount, marks themselves paid, and a settle-up view shows who owes the person who paid the café.
5. Closed bills go to a history the café can reopen or delete.

## 2. Architecture

```
┌─────────────┐      HTTP/JSON       ┌──────────────────────────────┐
│  Browser(s) │  ─────────────────▶  │  Node.js server (server.js)  │
│  café staff │  /api/bills, /api/   │  · REST-ish JSON API         │
│  customers  │  /menu, /bill/<id>   │  · serves the SPA            │
└─────────────┘  ◀─────────────────  │  · split maths (lib/calc.js) │
                    HTML/CSS/JS      └──────────────┬───────────────┘
                                                    │ read/write
                                             ┌──────▼───────┐
                                             │ data/        │
                                             │ store.json   │
                                             └──────────────┘
```

- **One process, no build step, zero npm dependencies** — Node's built-in `http` module only. Clone → `node server.js` → running.
- **Server-side state is the point**: the earlier private version kept data in one person's app; here the data lives on the server, so every device that opens the hosted URL sees the same bills. That is what makes café + customer sharing work.
- **Split maths is server-side** (`lib/calc.js`) so every viewer sees identical numbers. Rounding uses a largest-remainder pass so per-person totals sum exactly to the grand total to the cent.
- **Storage**: a single JSON file with atomic writes (temp file + rename). Simple, inspectable, back-up-able by copying one file.

## 3. Access model — café vs customers

There are deliberately only two levels (no accounts):

| Who | How they get in | What they can do |
| --- | --- | --- |
| **Café / staff** | Open the app root URL (`/`) | Everything: create/close/reopen bills, edit bills, manage the menu, delete bills |
| **Customers** | Open a **bill link** (`/bill/<id>`) shared by the café (e.g. shown as a QR code or sent by WhatsApp) | See that one bill, their own itemised card, and mark themselves paid |

- **Staff PIN (optional)**: if the `STAFF_PIN` environment variable is set, menu editing and bill deletion require it. The browser prompts once and remembers it for the session. Everything else stays open — that friction-free sharing is intentional for a café table.
- Bill IDs are unguessable (random hex), so a bill link is effectively a capability URL: holding the link is what grants access to that bill.

## 4. Hosting options & trade-offs

| Option | Cost | Data persistence | Effort | Notes |
| --- | --- | --- | --- | --- |
| **Render free tier** | Free | ❌ Ephemeral disk — resets on restart unless a paid Persistent Disk is attached | Low | Easiest public URL; free services also sleep when idle |
| **Railway** | Free trial / low-cost credits | ✅ with a Volume mounted at `data/` | Low | Good default for a real café pilot |
| **Fly.io** | Low cost | ✅ with a Fly Volume | Medium | Stays awake cheaply; slightly more setup |
| **Small VPS (e.g. Hetzner/DigitalOcean)** | ~US$4–6/mo | ✅ full control | Medium | Needs a reverse proxy (Caddy/nginx) for HTTPS and process care (systemd/pm2) |
| **Café's own machine/tablet on local Wi-Fi** | Free | ✅ | Low | Works in-café only; customers must join the café Wi-Fi; no public URL |

**Recommendation**: pilot on Railway with a volume (durable data, real URL), or a small VPS if the café wants full control. Use Render free only as a demo because of the ephemeral disk.

## 5. Security notes

- **This is a lightweight system, not a bank.** There are no user accounts and no passwords (except the optional staff PIN). Anyone with a bill link can edit that bill — acceptable for splitting a café bill among friends, not for sensitive data.
- **Never store card or M-Pesa PIN data in this app.** Payments happen outside it (cash, card terminal, or M-Pesa till/paybill) until a proper payment integration is added (see roadmap).
- Serve it over **HTTPS** (all recommended hosts provide it, or Caddy on a VPS) so bill links aren't readable on public Wi-Fi.
- The staff PIN travels as a header over HTTPS and is checked server-side; it protects menu prices and deletions from casual tampering, nothing more.
- Input is validated/coerced server-side, output is HTML-escaped in the frontend, and the JSON store is written atomically. There is no SQL anywhere, so no SQL-injection surface.

## 6. Roadmap / future improvements

1. **M-Pesa integration** — Safaricom Daraja API: STK Push so each person can pay their exact share from their settle-up card, with payment callbacks automatically flipping their "Paid" toggle. This is the single most valuable upgrade for a Kenyan café.
2. **QR codes per table** — print a QR per table that opens/creates that table's bill, removing the link-sharing step.
3. **Real accounts** — café owner login (and multiple staff), roles, and an audit trail of edits.
4. **Receipts** — per-person receipt view optimised for sharing to WhatsApp, plus end-of-day sales summary for the café.
5. **Database upgrade path** — swap `lib/store.js` for SQLite (still file-based, still no external service) when concurrency grows, then Postgres if it ever becomes multi-branch. The rest of the code only depends on the store's shape, so this is a contained change.
6. **Offline tolerance** — cache the menu in the browser so a flaky connection doesn't block adding items; sync when back online.
7. **Multi-branch / multi-currency** — only if the café grows; today it is proudly single-café, KSh-only.

## 7. Relationship to the private Muse version

Carleen also has a private version of this system inside Muse (an interactive artifact) for her own use. This folder is the independent, deployable twin: same features, but self-hosted, publicly reachable, and hers to push to GitHub and run anywhere.
