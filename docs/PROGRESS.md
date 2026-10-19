# Digital Workforce - Progress

## Done
- **Phase 1 - Foundation:** npm-workspaces monorepo (`apps/server`, `apps/web`, `packages/shared`), SQLite + Drizzle schema & migrations, auth (bcrypt, lockout, session rotation, CSRF double-submit, helmet, strict CORS, rate limits, TOTP for owner), roles, double-entry ledger (MINT/TREASURY/NPC pool), permission engine (flags x company x staff, deny-by-default), append-only audit log.
- **Phase 2 - Owner Dashboard:** 6-step Company Builder with Welcome Badge (print/copy, password shown once), Company List (search/filters), Company Detail (edit, permissions editor, reset password, force logout, suspend/archive/delete, clone-as-template, change industry with warning, money tools), View-as-company (read-only, bannered), bulk actions, permission templates, accounts manager (linked-account groups, moderators), feature flags + live economy settings, ledger viewer + CSV, audit viewer + CSV.
- **Phase 3 - Catalog & world:** 210 industries (30 categories x 7) with hand-written flavour + generator, 1,680 products, 40 commodities, office with drag-and-drop desks, workers with species/quirks/mood faces, workplaces & tiers, tick engine (5s), offline earnings capped at 8h with "While you were away" screen.
- **Phase 4 - Core gameplay:** Recruit Pods (odds shown, pity timers, big reveal), synergy combos, tap-to-boost with combos and daily cap, contracts board (speed bonus), random office events with choices (spec events + industry + drama events from worker relationships), daily streak Lucky Wheel, IPO Prestige, decor/pets shop with set bonuses, unlockable themes.

- **Phase 5 - Economy extras:** bank pots, savings interest, term deposits, transfers with fee + linked-account block, staff payroll, Treasury loans + peer lending, credit score, insurance, lotto, wealth tax, economy health monitor (Gini, inflation, auto-balancer).
- **Phase 6 - Products & trade:** production queues with auto-buy, equipment, warehouses, NPC customers (7 types) + reviews + reputation, marketing campaigns, supply-chain market + private deals, auction house (escrow, anti-sniping), invoices, property, fleet, financial statements, owner catalog manager.
- **Phase 7 - Bit Exchange:** owner-approved IPOs with a fair-price suggestion, order book + market maker, 3 price modes (player / fundamentals / owner), dividends + DRIP, ETFs/indexes, bonds, commodities, meme coins, board votes, buybacks, splits, takeovers, circuit breakers, watchlists, portfolio, owner Market tab.
- **Phase 8 - Social:** chat (global / company / guild / DM, profanity filter, rate limit, slow mode, mute, block, report, @mentions, kill switch, live over WebSocket with per-message permission checks); moderation center (reports queue with notes, live chat delete, chat logs, mutes/kicks, audit) for the owner and per-tool moderators; guilds (treasury wallet, XP levels, income perk, daily guild quest, parties, capped payouts, roles, leader hand-off); Business Wars (5 contest types scored on real stats, player challenges with accept/decline, guild Grand Prix auto-scheduler, owner scheduling, trophies); trade fairs (booths, bonus-price sales from the NPC pool, prize pool, reputation); mentorship; 7 leaderboards; public company profiles; Daily Byte generator (overtakes, market reports, record highs, classifieds, Boss Byte column).

- **Play for real (deploy):** first start on an empty database seeds itself (owner, catalog, Treasury); demo logins off in production (`SEED_DEMO`); owner must replace "Diddy" on first production login; `npm run play` for home/Wi-Fi play; Dockerfile + docker-compose + Render blueprint (`render.yaml`, persistent disk); https-only headers only when `COOKIE_SECURE=true` (plain-http Wi-Fi play works); owner "My account" tab (password + 2FA); README with the three ways to play. Verified: Docker image boots a fresh production game, owner -> builder -> badge -> player on a phone viewport, and a second device joining over the network address with live WebSocket updates.
- Balance tweak: the starter room has no upkeep (`workplaces.upkeepPerTick` floors), so a new company can't start in the red.

- **Real-life packages (flag `realPackages`):** owner packs batches of printable QR cards (Bits from the Treasury, free pods, decor/pets, timed income boost, mystery mode; cards x openings per card, expiry, optional target company), prints them, voids them and sees who opened what. Players scan with the phone camera (QR -> `/redeem/<code>` -> login -> unboxing) or type the code; in-app camera scanning where the browser has BarcodeDetector. Unambiguous 8-char codes, wrong-guess limit per account per hour, atomic claim (no double opening). Tested in `packages.test.ts` and end to end in a browser (print sheet, phone scan link, second finder sees "used up").

- **Phase 9 + chaos controls - "The Big Byte Update":**
  - **Arcade:** 12 playable mini-games (Debug Rush, Coffee Run, Email Sorter, Meme Maker, Server Whack, Invoice Match, Stock Sprint, Box Stack, Pizza Rush, Parking Panic, Cable Untangle, Quiz Show). Server-timed sessions, a points-per-second cheat check (flags go to anti-cheat), Quiz Show graded on the server, payouts from the Treasury capped per play and per day, personal bests and per-game high-score tables.
  - **Research:** 5 branches x 6 nodes with levels. Research Points come from every company plus THINKER workers. Effects plug into the multiplier registry (income, traffic, speed, quality, morale, wages, arcade payouts, offline hours, pod pity).
  - **Achievements:** 253 achievements (29 stat ladders x 8 tiers, plus levels, collection, prestige, meta and secret ones). Each pays from the Treasury and grants a title players can wear on their profile; live pop-up on unlock.
  - **Quests:** 3 daily + 3 weekly, picked to fit the company's enabled modules and scaled by level.
  - **Seasons:** owner season manager, season leaderboard via `s:<id>:` stat twins, a free 30-tier cosmetic-only pass (titles, 8 pass-exclusive cosmetics, decor), top-10 Treasury prizes, top-3 titles, Hall of Fame.
  - **Collection book:** species x rarity, backfilled for older companies.
  - **Owner Chaos Controls:** Credit Rain, Double-Bits (x1.5/x2/x3), spawn a Legendary, market crash/boom, Boss Byte broadcast (optionally into the Daily Byte), trigger office events for one company or everyone.

- **Phases 10-12 - ops, QA and polish:**
  - **Backups:** one-click and scheduled (`BACKUP_EVERY_HOURS`), with download, restore (safety backup first, live caches reloaded) and a settings export/import file.
  - **Owner dashboards:** Anti-cheat (flags, shared IPs, linked groups, big gifts, arcade outliers) and Analytics (active players, 10-day activity, industries, feature usage).
  - **Simulation:** `npm run simulate` runs 500+ bots in 5 play styles and reports supply, Gini, faucets and sinks.
  - **Load test:** `npm run loadtest` drives a real server with live WebSockets.
  - **Browser tests:** a Playwright suite covering owner and player flows, desktop and phone, with axe accessibility scans.
  - **CI:** GitHub Actions runs checks, browser tests, a simulation/load-test smoke run and a Docker build.
  - **Docs:** `docs/ECONOMY.md`, `docs/OWNER_GUIDE.md`, `docs/SIMULATION.md`.
- **Economy fixes found by the simulation:**
  - **Treasury burn:** surplus above `treasuryReserve` is destroyed, so sinks are real.
  - **Progressive production tax:** `incomeTaxFreePerTick` and `incomeTaxRate`.
  - **Auto-balancer reworked and on by default:** it now tunes the tax instead of flat wages, because raising wages bankrupted half the companies.
  - **Faster achievement checks:** one stats query per company instead of ~250.
- **Accessibility fixes from the axe scans:** darker green, pink and muted colours for contrast, rarity chips with readable text, a heading on every page, proper roles on progress pips.

- **Supabase backend:**
  - **System of record:** Supabase Postgres (project `digital-workforce`, us-east-1, schema `game`, 71 tables, RLS on everything, locked away from the public API) holds the game.
  - **Fast local copy:** the engine keeps a local SQLite working copy because the tick makes thousands of tiny queries. SQLite triggers capture every insert, update and delete into `_sync_queue`, which is streamed to Postgres in batched upserts every ~2 s inside a transaction and retried with backoff if Supabase is unreachable.
  - **Start-up and shutdown:** an empty server rebuilds itself from Supabase on start, and the last changes are flushed on shutdown.
  - **Owner tools:** a status card and "Sync now" button on 💾 Backups.
  - **Verified:** tests against a real Postgres engine (PGlite) cover the full upload, streaming and rebuilding a fresh server. An end-to-end run against Postgres 17 had server 1 upload, play and shut down, then server 2 on a blank disk reloaded 6,904 rows and the player logged straight in. The schema is applied to the real Supabase project.
  - **Hosting:** Render can now run on the free plan (no disk).

## Still open / ideas
- Supabase writes trail the game by up to ~2 seconds (a hard crash loses at most those seconds). Only one game server should write to a given Supabase project at a time.
- Options and margin trading are only partly built (short selling is behind the `shorting` flag; there is no options chain).
- Localization: only English strings exist (the i18n scaffold is in `apps/web/src/i18n`).
- Browser notifications work while the game is open (even in a background tab); there is no Web Push server yet for when the app is fully closed.
- The economy still runs hot in the first day of a brand-new game while every company starts at once; the auto-balancer settles it over the following days (see `docs/SIMULATION.md`).

## Decisions / defaults
- **SQLite via better-sqlite3 (synchronous).** Every service call runs to completion; `atomic()` wraps multi-step writes in a real transaction. Schema stays Postgres-ready (text ids, integer money, JSON as text).
- **Money supply** = `-balance(MINT)`. Only MINT may go negative, so the sum of all wallets is always exactly 0.
- **Passive production income** is minted (faucet) and bounded by the offline cap; wages/upkeep/purchases flow to the Treasury (sink). Rewards (contracts, events, wheel) are paid from the Treasury. NPC customer purchases come from the budgeted NPC pool.
- Account numbers are strings; auto-numbering = highest numeric + 1, zero-padded to 2 digits.
- Owner credentials come from `.env` (`OWNER_ACCOUNT_NUMBER`/`OWNER_PASSWORD`, default `01`/`Diddy`) and only at seed time.
- Tick = 5 s. Fractional Bits are carried between ticks in memory (lost on restart - at most 1 BT per company).
- Fonts: system rounded fonts only (no external assets).
- `legacy-peer-deps=true` in `.npmrc`: npm's arborist crashes on Vite 7's optional peer graph inside workspaces. Remaining `npm audit` notes are dev-only build tools (tailwind 3's `braces`, drizzle-kit's esbuild).
- Social payouts (war prizes, fair prizes, guild quests, mentorship) come from the Treasury and are skipped/partial when it is low, so they never mint Bits. Fair booth sales come from the NPC pool.
- Player-issued war challenges use a small Treasury prize (`wars.challengePrize`) and a daily cap so two friends can't farm it.
- Run tests with `npm test` (or `npx vitest run` at the root, which delegates to `apps/server` and its in-memory DB config).
