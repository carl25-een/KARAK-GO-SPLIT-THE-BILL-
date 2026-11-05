# 🍵 Matcha Café — Split the Bill

A small, self-contained **split-the-bill system for a matcha café**. Staff create a bill for a table, add what was ordered from the café menu, and the system works out exactly what each person owes — then shows who owes whom when one person pays the café.

It is the standalone, publicly hostable version of the system: all data lives **server-side**, so the café and customers who open the same hosted URL share the same bills in real time.

## Features

- **Bills** — create a bill with an occasion, table number and everyone's names; close bills into a settled history; reopen or delete them later.
- **Café menu** — 14 matcha drinks, desserts, food and extras priced in KSh, seeded on first run and fully editable by the café (add / edit / delete). Bills keep the price an item was added at, so menu edits never change a bill in progress.
- **Custom items** — add one-off items (name + price) to any bill.
- **Three ways to split**
  - *Equally* between everyone,
  - *By item* — tap names on each item to say who had it; shared items split between the people tapped (unassigned items are shared by everyone),
  - *By percentage* — custom shares per person.
- **Tip %, tax % and discount** (percent or fixed KSh amount). Per-person totals are itemised (items / tax / tip) and rounded so they always sum **exactly** to the grand total.
- **Mark paid** per person, plus a **Settle up** view: pick who paid the café and see who owes them (and who has settled).
- **Shareable bill links** — every bill has its own URL (`/bill/<id>`) the café can send to the table; customers opening it see the same live bill and their own card.
- **Optional staff PIN** — set `STAFF_PIN` to protect menu editing and bill deletion.
- **Mobile-friendly**, matcha-green café styling, no build step.

## Tech

- **Node.js ≥ 18, zero dependencies** — just the built-in `http` module, so there is nothing to install and no native modules to compile.
- **Data**: a JSON file store (`data/store.json`), written atomically. No external database service required.
- **Frontend**: one vanilla-JS single-page app served by the same server.

> Why zero-dependency? It runs anywhere Node runs with a single command, deploys without a build, and avoids install/native-compile surprises on free hosting tiers. See `PLAN.md` for the architecture and how it could scale later.

## Run it locally

```bash
# 1. (optional) set a staff PIN and port
cp .env.example .env   # then edit .env

# 2. start it
node server.js
# or
npm start
```

Open <http://localhost:3000>. That's it — no `npm install` needed.

Pages: `/` is the introduction page; the app itself lives at `/app`. Bill links (`/bill/<id>`) are unchanged and open the bill directly.

Try it: start a bill → add a few matcha lattes → switch the split to **By item** and tap names → set who paid the café → watch **Settle up**.

## Environment variables

| Variable    | Default | Purpose                                                              |
| ----------- | ------- | -------------------------------------------------------------------- |
| `PORT`      | `3000`  | Port to listen on. Hosting providers set this automatically.        |
| `STAFF_PIN` | _(off)_ | If set, menu edits and bill deletion require this PIN in the staff view. |

## Deploy

The app is a single long-running Node process with a writable `data/` folder. Any Node host works.

### Render (free tier)

1. Push this repo to GitHub.
2. In Render: **New → Web Service**, connect the repo.
3. Build command: leave empty (or `npm install` — a no-op here). Start command: `node server.js`.
4. (Optional) In **Environment**, add `STAFF_PIN`.
5. ⚠️ **Free-tier caveat**: Render's free disk is *ephemeral* — `data/store.json` resets when the service restarts/redeploys, and free services also spin down after ~15 idle minutes. Free web services **cannot** attach a Render **Persistent Disk** — that is a paid-instance feature only — so on the free tier there is no way to make the data survive. Treat a free Render deploy as a demo only; for a real pilot use Railway (below) or a paid Render instance, and see the scaling notes in `PLAN.md`.

### Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**. Railway detects Node and runs `npm start`.
3. (Optional) Add `STAFF_PIN` under **Variables**.
4. For durable data, add a **Volume** mounted at `/data`… note the app writes relative to its own folder, so mount the volume at the app's `data` directory path shown in Railway (or set the working directory accordingly). Without a volume, data resets on redeploy.

### Any VPS / your own machine

```bash
git clone <your-repo-url>
cd matcha-cafe-split-bill
PORT=3000 STAFF_PIN=yourpin node server.js
```

Put it behind a reverse proxy (e.g. Caddy or nginx) for HTTPS.

## Project structure

```
matcha-cafe-split-bill/
├── server.js          # zero-dependency HTTP server + JSON API
├── lib/
│   ├── store.js       # JSON file store + seeded café menu
│   └── calc.js        # split maths (exact-cent rounding, settle up)
├── public/
│   ├── index.html     # app shell
│   ├── styles.css     # matcha-green styling
│   └── app.js         # single-page frontend (no build step)
├── data/              # store.json lives here (git-ignored, created at runtime)
├── .env.example       # PORT, STAFF_PIN
├── package.json
├── PLAN.md            # hosted-system plan: architecture, access model, hosting, roadmap
└── README.md
```

## Notes & limits

- Access is intentionally lightweight: anyone with a bill link can view and edit that bill (that's what makes table sharing frictionless). The staff PIN only guards menu editing and bill deletion — it is not full user authentication. Read the security notes in `PLAN.md` before using it with real money at stake.
- Data is a single JSON file: perfect for one café, not designed for many branches or heavy traffic. `PLAN.md` describes the path to SQLite/Postgres if that day comes.
