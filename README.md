# 🤖 Digital Workforce Live

A cartoon office economy for you and your friends. **Everything is made and traded by real players.** Nothing earns while you're away, and there are no computer customers. If you want Bits, another player has to want what you make.

- **Make things.** Each player spends their own ⚡ Energy to work shifts at their company's facilities: farm wheat, mine ore, mill flour, bake bread, forge tools.
- **Trade with friends.** Use the market order book, your own shop, pickup orders, a real-life POS register with QR codes, or direct transfers.
- **Eat, build, show off.** Food refills Energy. Planks and steel build new facilities. Furniture, uniforms and gadgets go in your office for prestige.
- **Do politics.** Form unions, elect a President, Vice President and Treasurer, and call votes of no confidence. Vote on the Owner's laws in the Town Hall, and sue each other in the Courthouse.

You are the **Owner** (login `01` / `Diddy`; the game makes you pick a new password the first time). You create the companies and logins, hold the Treasury, set the tax, audit people, judge court cases and propose laws.

Bits are pretend money. Nothing here is real money, crypto or securities.

---

## Put it online: Netlify + Supabase (free)

Netlify hosts the pages and runs the game's API as serverless functions. Supabase holds all the data and sends live updates. You need **one setting**.

1. **Get your database address from Supabase.** Open your project (`digital-workforce`) → **Connect** (top bar) → **Transaction pooler**. Copy the connection string: it looks like `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`. Put your database password where it says `[YOUR-PASSWORD]`. (Forgot it? Project Settings → Database → Reset database password.)
2. **Give it to Netlify.** Your site → **Site configuration → Environment variables → Add a variable**: key `DATABASE_URL`, value = that string.
3. **Deploy this branch.** Netlify reads `netlify.toml` from the repo: it builds the pages, publishes the API at `/api`, and runs a small job every 10 minutes that closes elections and court hearings. Use **Deploys → Trigger deploy → Clear cache and deploy site**. Make sure Netlify builds the branch that has this code (Site configuration → Build & deploy → Branches).
4. **Open your Netlify address** and log in with `01` / `Diddy`. The game creates its tables on the first visit (they are already set up in your Supabase project).

Optional settings in Netlify:
- `OWNER_PASSWORD`: a different first-login password for the Owner.
- `OWNER_RESET_PASSWORD=true`: for one deploy, if you ever get locked out.

**If it says "Can't reach the game"**, open `https://<your-site>.netlify.app/api/health`:
- `"database": "connected"`: all good. Reload the game.
- `"problem": "..."`: it tells you exactly what to fix (missing `DATABASE_URL`, wrong password, wrong address).
- A Netlify "Page not found": the API function wasn't deployed. Check the deploy log, and that Netlify builds the branch with `netlify.toml` and the `netlify/functions` folder (Base directory must be empty, not `apps/web`).

## Play on your computer (no setup)

```bash
npm install
npm run dev
```

Open http://localhost:5173 and log in with `01` / `Diddy`. Local play keeps its data in `data/pglite` (a little Postgres built in), so you don't need Supabase. If you set `DATABASE_URL` locally, it uses your Supabase instead.

On your home Wi-Fi: run `npm run play` and have friends open `http://<your-computer's-IP>:8888`.

---

## Owner quick guide

| Where | What you do |
|---|---|
| 👑 Overview | Treasury, money supply, players online, trades and tax today. |
| 🏢 Companies | Create a company for each friend: pick its starting facility and get a login to hand out. You can also grant, mint, fine, audit, reset passwords or suspend. |
| 💰 Economy | Mint or burn Treasury Bits, and set the rules (sales tax, starting grant, election and court timings, union tax discount). **New season** wipes the economy and starts everyone fresh. |
| 🏛️ Justice & laws | **Court:** you are the judge (damages, fines, asset freezes, feature suspensions). The State can sue too, and if you don't rule within 2 hours of a hearing, the evidence decides. **Tax audits:** see untaxed transfers and fine. **Sanctions.** **Laws:** sales tax, stimulus, Energy boost; companies vote and you can sign or veto. **Unions:** dissolve. |
| 🎁 QR cards | Print real-life reward cards. Bits come out of the Treasury when someone scans one. |
| 💬 Chat | Delete messages as the Owner. |

**How money works.** The only ways Bits enter the game are starting grants, your mints, Treasury grants and stimulus, and QR cards. They leave through sales tax (5% by default), building costs, union fees, court fees and fines, all of which go to the Treasury. Every movement is in the ledger, and the ledger must always balance.

## How to play (for your friends)

1. Log in with the account number and password the Owner gave you, then pick your own password.
2. **🏢 Office:** work shifts with your Energy. Each recipe shows what it takes and makes. Tools add +50%. Eat food to refill Energy.
3. **📈 Market:** post buy or sell orders. A trade happens when a buyer's price meets a seller's.
4. **🧾 My shop & POS:** set shop prices. At a real table, ring up a sale and your friend scans the QR (or types the code) under **💳 Pay**.
5. **🏗️ Build:** new facilities and upgrades need planks and steel, so somebody has to make them.
6. **✊ Union**, **🏛️ Town Hall**, **⚖️ Court:** politics, laws and lawsuits, all between real players.
7. **👥 Team:** company admins can add logins for more friends. Each friend has their own Energy.

---

## For developers

- `apps/api`: the game API (TypeScript, Drizzle, Postgres). It's a single `handle(Request) → Response` function used by both the Netlify Function (`netlify/functions/api.mts`) and the local server (`src/dev.ts`). Timed things (elections, hearings, appeal windows, bills, union dues) are settled by `services/sweep.ts`, which runs on API traffic and every 10 minutes (`netlify/functions/sweep.mts`).
- `apps/web`: React + Vite + Tailwind. Live updates come from Supabase Realtime "hints" (`src/lib/live.ts`); pages also refetch on a timer.
- `packages/shared/src/live`: the item, facility, recipe and rules catalogue shared by both.
- Database changes: edit `apps/api/src/db/schema.ts`, then run `npm run db:generate` (writes SQL and bundles it into the function). New migrations apply on the next cold start.
- `npm test`: API tests on an in-process Postgres (PGlite). `npm run test:e2e`: browser tests. `npm run typecheck`, `npm run lint`.

Design notes are in [docs/SPEC-v2.md](docs/SPEC-v2.md) and progress in [docs/PROGRESS.md](docs/PROGRESS.md).
