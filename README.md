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
| Let friends play from anywhere, on their phones | [Host it online](#3-host-it-online-so-anyone-you-invite-can-play) | ~$7/month on Render |

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

#### Easiest: Render (one click)

1. Put this project in your own GitHub repository.
2. Sign up at <https://render.com>, click **New → Blueprint**, and pick the repository. Render reads [`render.yaml`](render.yaml).
3. When it asks for **OWNER_PASSWORD**, type a strong password of your own. `APP_SECRET` is generated for you.
4. Wait for the deploy, then open the `https://...onrender.com` address Render gives you. Log in as `01` with your password.

The blueprint uses Render's **Starter** plan with a 1 GB disk, because the game needs a disk to remember everyone's progress. Free instances lose their data when they restart.

#### Any server with Docker (VPS, home server, Raspberry Pi 4/5)

```bash
cp .env.example .env      # then edit .env: set OWNER_PASSWORD and APP_SECRET
docker compose up -d --build
```

The game is on port 3000. Put it behind HTTPS (for example Caddy or Cloudflare Tunnel), then set `COOKIE_SECURE=true` and `PUBLIC_URL=https://your-domain` in `.env`. Everyone's progress lives in the `game-data` Docker volume.

#### What happens on the first start

A brand-new server sets itself up automatically: database, the 210 industries, the Treasury and the owner account. Demo companies are **off** in production. To turn them on, set `SEED_DEMO=true`.

---

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

### 🌪️ Chaos & Seasons

**Owner Control Panel → 🌪️ Chaos & Seasons** has the fun buttons: Credit Rain (Bits for every active company), Double-Bits Hour, summon a Legendary worker, market crash or boom, Boss Byte broadcasts and office events. Start a **season** there to reset the season leaderboard, open a free cosmetic season pass, and pay prizes to the top 10 when it ends. Winners go into the Hall of Fame.

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
