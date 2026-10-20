# 🤖 Digital Workforce

An invite-only, cartoon office-tycoon browser game. Players run silly digital companies in 210 industries, hire quirky workers, sell products, trade on the Bit Exchange, join guilds and fight friendly Business Wars, all with **Bits (BT)**, a fictional currency. Bits are never real money: there are no payments, crypto or real securities, and nothing is pay-to-win.

You are the **Owner**. You create every company and login from the Owner Control Panel, hand out the login badges, and control exactly what each player can do.

> ⚠️ **The default owner login is `01` / `Diddy`. "Diddy" is a weak password.** Change it before anyone else can reach your game (see [Changing the owner password](#changing-the-owner-password)). When the game runs in production mode it forces you to change it on your first login.

---

## Ways to play

| You want to... | Do this | Cost |
|---|---|---|
| Try it yourself right now | [Play on your computer](#1-play-on-your-computer) | Free |
| Play with friends and family in the same house | [Play on your home Wi-Fi](#2-play-with-people-on-your-wi-fi) | Free |
| Let friends play from anywhere, on their phones | [Host it online](#3-host-it-online-so-anyone-you-invite-can-play) | Free (Render + Supabase) |

Everyone plays in a normal web browser: phone, tablet or computer. On a phone, use **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android) and it opens like an app.

### 1. Play on your computer

1. Install **Node.js 20 or newer** from <https://nodejs.org> (the "LTS" button).
2. Download this project (green **Code** button on GitHub → **Download ZIP**, then unzip it), or `git clone` it.
3. Open a terminal in the project folder and run:

   ```bash
   npm install
   npm run seed
   npm run dev
   ```

4. Open <http://localhost:5173>.
   - Owner: `01` / `Diddy`
   - Demo companies to play straight away: logins `02`, `03`, `04`, `05`, password `demo1234`

### 2. Play with people on your Wi-Fi

Run the game in "play" mode on one computer, and everyone in the house joins from their own device:

```bash
npm install
npm run play
```

Then find that computer's local address (Windows: `ipconfig`; Mac: System Settings → Wi-Fi → Details; Linux: `hostname -I`). It looks like `192.168.1.23`. On each phone, open `http://192.168.1.23:3000`.

Make each player a company in **Owner Control Panel → Company Builder** and give them their Welcome Badge (it has their account number and a one-time password). The computer running the game has to stay on while people play.

### 3. Host it online so anyone you invite can play

#### Easiest: Render + Supabase (free)

The game's data lives in **Supabase** (your project `digital-workforce`), so the server itself needs no disk and Render's free plan works.

1. **Get your Supabase connection string.**
   - Open your project at <https://supabase.com/dashboard/project/rkrxszigtrjmboesxvhn>.
   - Click **Connect** (top of the page), choose **Session pooler**, and copy the URI. It looks like `postgresql://postgres.rkrxszigtrjmboesxvhn:[YOUR-PASSWORD]@aws-…-us-east-1.pooler.supabase.com:5432/postgres`.
   - Don't know the database password? Go to **Project Settings → Database → Reset database password**, then put that password into the URI.
2. Put this project in your own GitHub repository.
3. Sign up at <https://render.com>, click **New → Blueprint**, and pick the repository. Render reads [`render.yaml`](render.yaml).
4. When it asks for **DATABASE_URL**, paste the connection string from step 1.
5. Wait for the deploy, then open the `https://...onrender.com` address. Log in as `01` / `Diddy` and pick a new password.

**What happens behind the scenes:**
- The server keeps a fast working copy of the game and copies every change to Supabase within about 2 seconds.
- When the server restarts (a deploy, or Render waking it from sleep), it reloads the whole game from Supabase.
- You can browse all the data in Supabase under **Table Editor → schema `game`**. That schema is locked away from Supabase's public API, so only the game server can read it.
- **🛠 Owner Panel → 💾 Backups** shows the live sync status.

> Free-plan notes:
> - Render sleeps the server after about 15 minutes without visitors, so companies earn their offline income (capped at 8 hours) instead of live income.
> - Supabase pauses free projects after a week of no activity at all. A game people play stays active.

#### Any server with Docker (VPS, home server, Raspberry Pi 4/5)

```bash
cp .env.example .env      # then edit .env: set OWNER_PASSWORD and APP_SECRET
docker compose up -d --build
```

The game is on port 3000. Put it behind HTTPS (for example Caddy or Cloudflare Tunnel), then set `COOKIE_SECURE=true` and `PUBLIC_URL=https://your-domain` in `.env`. Everyone's progress lives in the `game-data` Docker volume.

#### What happens on the first start

A brand-new server sets itself up automatically: database, the 210 industries, the Treasury and the owner account. Demo companies are **off** in production. To turn them on, set `SEED_DEMO=true`.

---

### 4. Keep your Netlify address (Netlify for the pages + Render for the game server)
Netlify only serves web pages; it can't run the game server, which has to stay on and keep live connections open. So the server runs on Render (free) and Netlify forwards the game's requests to it. Players only ever see your Netlify address.

1. **Start the game server on Render:** follow step 3 above (Render → New → Blueprint → this repo, paste your Supabase `DATABASE_URL`). When it is live, copy its address, e.g. `https://digital-workforce.onrender.com`.
2. **Tell Render about Netlify:** in Render → your service → *Environment*, set:
   - `PUBLIC_URL` = your Netlify address, e.g. `https://my-game.netlify.app` (lets the live connection in and makes QR codes point at Netlify)
   - `TRUST_PROXY` = `2` (so the game sees each player's real address, not Netlify's)
3. **Point Netlify at the server:** in Netlify → *Site configuration* → *Environment variables*, add `GAME_SERVER_URL` = the Render address from step 1.
4. **Redeploy on Netlify** (*Deploys* → *Trigger deploy* → *Clear cache and deploy site*). The repo's `netlify.toml` already sets the build: it builds the pages and forwards `/api` to `GAME_SERVER_URL`. If the variable is missing, the build stops with a message saying so.

Open your Netlify address and log in as `01` / `Diddy`. On Render's free plan the server sleeps after ~15 minutes alone; the first visit after that can take ~30–60 seconds (the login screen says the server is waking up; try again).

## Owner quick guide

1. **Log in** as `01`. In production you change the password straight away.
2. **Company Builder**: pick a name, logo, colour and industry, a starting package and permissions. Then print or copy the **Welcome Badge** and hand it to the player. The password on the badge is shown only once, and the player has to change it on their first login.
3. **Companies**: edit a company, turn features on or off for it (changes apply instantly), reset passwords, suspend, or "view as" the company to see exactly what they see.
4. **Flags & settings**: switch whole features on or off for everyone, change economy numbers live, post an announcement, or put the game in maintenance (read-only) mode.
5. **Economy / Market / Social / Moderation**: watch inflation, approve IPOs, start Business Wars and trade fairs, and handle chat reports.

### 📦 Real-life packages (QR cards)

Hand out real, physical rewards: **Owner Control Panel → 📦 Packages**.

1. Choose what's inside: Bits, recruit pods, decor or pets, or a temporary income boost. You can also make it a ❓ mystery.
2. Choose how many cards, how many times each card can be opened (1 = first finder wins), an optional expiry date, and optionally lock it to one company.
3. Click **Print cards**, cut them out, then give them away, hide them, or tuck them into a real present.
4. A player scans the QR code with their phone camera. The game opens, they log in if needed, and they unbox it. They can also type the code under **📦 Packages**.

Print from the game's real address (your Wi-Fi address or hosted URL), not `localhost`, so the QR codes work on other people's phones. Bits come from the Treasury, codes are random, and wrong guesses are limited. **Packages** shows who opened what, and **Void** kills a batch of codes. To turn the whole feature off: **Flags & settings → Real-life packages**.

### 🧾 POS registers and online shops
- **Selling in person:** open **🧾 POS Register**, tap products, press **Charge**. The customer scans the QR with their phone (or opens **💳 Pay** and types the code) and pays with their company's Bits.
- **Selling online:** anything you list as on sale shows up in **🛒 Shops**. Customers pay now or at pickup and get a pickup code. Find the code under **Online orders** and hand the order over.
- **Tax:** every sale includes 5% sales tax, which goes to the Treasury.

### ♟️ Strategy, unions and justice
- **♟️ Strategy Room:** 500 timed plays across 10 categories (Marketing, Operations, Finance, People, R&D, Sales, Legal, Lobbying, Expansion and Shady Deals), each in 5 tiers that unlock with company level. Players also set company policies, fight for control of 8 market districts, and spend influence lobbying on bills.
- **✊ Unions:** businesses join together, and each one names a rep. Members elect a President, Vice President and Treasurer every 3 days (or early), can hold votes of no confidence, pay daily dues, and use the treasury for collective bargaining, co-op marketing, strikes, grants and lobbying.
- **⚖️ Courthouse:** companies sue each other, file evidence, offer settlements and appeal once. The Owner is the judge; if you don't rule within 2 hours of the hearing, the auto-judge decides on the evidence.
- **Your powers (Owner Panel → 🏛️ Justice & Politics):**
  - **Tax audits:** desk, field and forensic audits find income hidden by shady deals. You then clear the company, warn it, fine it (optionally freezing its assets) or take it to court.
  - **Court:** take any company to court as the State, rule on every case, and order damages, fines, asset freezes and licence suspensions (switching off a module for a while).
  - **Laws and unions:** introduce bills, sign or veto them, impose or lift sanctions, and dissolve unions.

### 🌪️ Chaos & Seasons

**Owner Control Panel → 🌪️ Chaos & Seasons** has the fun buttons: Credit Rain (Bits for every active company), Double-Bits Hour, summon a Legendary worker, market crash or boom, Boss Byte broadcasts and office events. Start a **season** there to reset the season leaderboard, open a free cosmetic season pass, and pay prizes to the top 10 when it ends. Winners go into the Hall of Fame.

### Login says "Can't reach the game server" (or "Request failed (404)")?
The page you opened is not connected to the game server, so the login address does not exist there. This game is one app: the server serves the pages **and** the `/api` they talk to.
- **On your computer:** run `npm run dev` from the project folder and open http://localhost:5173, or run `npm run build` then `npm start` and open http://localhost:3000. Opening `apps/web/dist/index.html` directly, or running only the web part, won't work.
- **Online:** deploy the whole repo with Render (or Docker) as described above. Static hosts such as GitHub Pages, Netlify, Vercel or Lovable only serve the pages, not the game server. For Netlify, follow "Keep your Netlify address" above.

### Can't log in as the owner?

- **Account number:** `01` (typing `1` also works). **Password:** `Diddy`, unless you set `OWNER_PASSWORD`.
- On a hosted game the first login asks you to choose a new password. After that, use your new one.
- **Locked out or forgot it?** Set `OWNER_RESET_PASSWORD=true` (in `.env` or your host's dashboard) and restart once. The owner password is reset to `OWNER_PASSWORD` (default `Diddy`) and the badge is unlocked. Then set it back to `false`.
- Five wrong guesses lock the badge for 15 minutes.

### Changing the owner password

- In the game: log in as the owner → **🔑 My account** tab → **Change your password**. You can also turn on two-factor login codes there. Players change theirs under **Settings**.
- Before the very first start (or on a fresh database): set `OWNER_PASSWORD` in `.env` (or in Render's dashboard). This value is only used when the owner account is first created. After that, change the password inside the game.

### Backing up

All game data is one SQLite file: `data/digital-workforce.db` locally, or `/data/digital-workforce.db` in Docker/Render. Copy it while the game is stopped to back it up.

---

## For developers

| Command | What it does |
|---|---|
| `npm run dev` | API on :3000 + web app with hot reload on :5173 |
| `npm run play` | Build the web app and serve everything from :3000 |
| `npm run seed` | Create the owner, templates and demo data (safe to re-run) |
| `npm test` | Server test suite (in-memory database) |
| `npm run test:e2e` | Browser tests (desktop + phone + accessibility scans) with Playwright |
| `npm run simulate` | 500-bot economy simulation report (see [docs/ECONOMY.md](docs/ECONOMY.md)) |
| `npm run loadtest` | Load test: hundreds of players over HTTP + live WebSockets |
| `npm run typecheck` / `npm run lint` | Type and lint checks |

- Stack: Node + Express + `ws`, SQLite (better-sqlite3 + Drizzle), React + Vite + Tailwind + Framer Motion.
- Every balance number lives in [`apps/server/src/config/economy.ts`](apps/server/src/config/economy.ts).
- Owner manual: [`docs/OWNER_GUIDE.md`](docs/OWNER_GUIDE.md). Economy design and simulation results: [`docs/ECONOMY.md`](docs/ECONOMY.md).
- GitHub Actions runs typecheck, lint, unit tests, browser tests, a simulation + load test smoke run and a Docker build on every push ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- Full design spec: [`docs/SPEC.md`](docs/SPEC.md). What is done and what is next: [`docs/PROGRESS.md`](docs/PROGRESS.md).
- Configuration: copy [`.env.example`](.env.example) to `.env`. Never commit `.env`.
