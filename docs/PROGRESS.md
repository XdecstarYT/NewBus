# Digital Workforce - Progress

## Now: Digital Workforce Live (v2)
Design: [SPEC-v2.md](SPEC-v2.md). It's a player-run economy hosted on **Netlify + Supabase** only.

### Done
- **Hosting:**
  - The API is one `handle(Request) → Response` function (`apps/api`), served by a Netlify Function at `/api`.
  - Supabase Postgres (schema `live`, 31 tables, RLS on, no public grants) is the only database. It's reached through the transaction pooler (postgres.js, no prepared statements).
  - Migrations are bundled into the function and applied on cold start under a transaction lock. They are already applied to the Supabase project.
  - A scheduled function settles timed events every 10 minutes.
  - Local play needs no setup (built-in PGlite).
- **Live updates:** API transactions call `live.hint()`, which wraps `realtime.send`. Browsers subscribe with the publishable key and only receive "refetch X" hints, never game data. Pages also refetch on timers, so the game works if Realtime is off.
- **Accounts:**
  - The Owner is seeded from the environment (default `01` / `Diddy`, password change forced on first login, `OWNER_RESET_PASSWORD`).
  - The Owner creates companies with an admin login; admins add staff logins (up to 12).
  - Sessions use hashed tokens in an HttpOnly cookie. CSRF uses a double-submit cookie. Accounts lock for 15 minutes after 5 bad passwords. "1" means "01".
- **Player economy (no offline or NPC income):**
  - **Energy:** personal per player, 100 max, +10/h; furniture and uniforms raise both, and so can a law.
  - **Production:** 15 facilities and 18 items, recipes, levels 1–5, and tools for +50% output (10 batches each). Food restores Energy. Furniture, uniforms and gadgets can be installed for prestige.
  - **Building:** costs Bits plus planks and steel.
- **Money:**
  - Double-entry ledger in which no wallet goes negative except the Mint. Bits only enter through starting grants, Owner mints and grants, stimulus and QR cards.
  - Sinks are sales tax, building, union and court fees, and fines.
- **Trading:**
  - **Market:** an escrowed order book that fills at the maker's price, with the seller paying tax.
  - **Shops:** buy now, or pickup orders that hold the stock until the buyer pays at the counter.
  - **POS register:** a 6-letter code and QR to pay.
  - **Transfers:** Bits and items.
- **Unions:**
  - One rep per company; President, Vice President and Treasurer elections (nominations → secret ballot → result).
  - Votes of no confidence, resignations with automatic elections, and term-end elections.
  - Daily dues, with expulsion after 3 missed days.
  - Treasury grants, and half sales tax between members.
- **Town Hall:** the Owner proposes laws (sales tax, stimulus, Energy boost). Companies vote; laws close by vote count and the Owner can sign or veto.
- **Courthouse:**
  - Company v. company or the State v. a company, with filing fees.
  - Evidence with weights and costs, and settlements.
  - The Owner rules; if not within 2 hours of the hearing, the auto-judge decides.
  - One appeal with a 24 h window. Remedies apply when the window closes: damages, fines, asset freezes and feature suspensions (work, market, shop, transfers, build).
- **Tax audits:** taxed sales vs untaxed transfers and item shipments over 7 days, with a suggested fine. Outcomes: clean, warning, fined (with an optional freeze) or referred to court.
- **Social:** chat (global, company, union, DMs; rate limit; Owner delete and mute), notifications, a news feed made from real events, and leaderboards (net worth at market prices, prestige, work).
- **Owner panel:** overview, companies (create, grant, mint, fine, audit, reset password, suspend), economy (mint/burn, rules, ledger, new season), justice & laws, and QR reward cards.
- **Tests:**
  - 17 API tests on PGlite: economy, market, shops and POS, building, staff, unions, laws, audits, court, chat, season reset, ledger balance.
  - 2 browser tests: Owner setup, then two friends work, trade and pay at the register.

- **Mega update 2: office work and AI**
  - Office work: 67 built-in templates in 18 categories (24 checked instantly, the rest AI-graded), Owner-made templates with reference data and three grading modes, an AI template maker, jobs with spots, timers and pay by score held in a Jobs wallet, an Owner review queue, and automatic jobs from AI clients.
  - AI (key `AIK`): structured JSON calls with a short timeout and fallbacks. It grades written work (answers are wrapped as data), plays customers and clients, decides haggles and drafts templates. Slow calls only happen in the scheduled function; players never wait more than a few seconds.
  - AI customers: goods leave the economy and are paid by the Treasury at a premium.
  - Contracts with escrow, delivery, expiry and breach (−5 prestige, can be sued).
  - Daily quests, personal skill levels (+2% shift output per level, up to +40%), and company badges.
  - Tests: 25 API tests (8 new) and 3 browser tests. Tables applied to Supabase as `0001_mega2`.

- **Owner AI tools and game time**
  - Game clock: 1 real hour = 12 game hours (`packages/shared/src/live/time.ts`). Durations entered in hours/days (contracts, jobs, requests, elections, court, laws, sanctions, union terms) and game days (quests, union dues, AI client jobs) use it; office-job timers, Energy, mutes and checkout codes stay real-time.
  - AI actions: plain-English orders become typed actions the Owner edits and sends: Bit/goods requests (`owner_requests`, pay/decline/expire), grants, fines, messages, news and client jobs.
  - Send an AI client to a company: one AI call writes the client and a new job, or picks a ready-made job.
  - Tests: 28 API tests, 3 browser tests. Tables applied to Supabase as `0002_owner_requests`.

- **Town & Finance update**
  - Loans: offers (escrowed) and requests, flat interest, game-day terms, partial repayment, auto-collection when overdue, defaults, credit scores (300–850).
  - Auctions: escrowed bids with instant refunds when outbid, +5% minimum raise, anti-sniping, Owner auctions of new goods for the Treasury.
  - Town projects from 6 blueprints (scalable), contributions with points and prestige, boosts on completion, full refunds on failure.
  - World events: one random event per game day (11 kinds), Owner can start one or switch them off. Boosts plug into shift output, sales tax, AI customer demand and prices, Energy regen and quest rewards.
  - Tests: 37 API tests, 4 browser tests. Tables applied to Supabase as `0003_town`.

- **3D town & real estate update**
  - 10×10 land plots (8×8 blocks, 12 high) priced by distance to the centre; buy from the Town, list for sale, buy from players (sales tax applies), rename, Owner reclaim. Up to 6 plots per company.
  - Building: 9 block types, each a real item; edits are batched (up to 300), validated on the server (inside the plot, resting on the ground or another block), and only the net materials move.
  - New Kiln facility with 🧱 bricks and 🪟 glass.
  - 3D view in three.js (lazy-loaded; instanced blocks, shadows, orbit camera, ghost preview, click to place, right-click/eraser to remove) plus a 2D map and a floor-by-floor plan for phones and screen readers.
  - Property value (land + 1.5× materials) on the leaderboard. Tests: 38 API tests, 5 browser tests. Table applied to Supabase as `0004_estate`.

### Still open / ideas
- Live updates use public broadcast channels whose names contain unguessable ids; the hints carry no game data. Private channels would need Supabase Auth.
- `packages/shared` still contains the v1 catalogue modules (unused by v2).

## Before: v1 (one always-on server)
v1 was a single Node server with SQLite, NPC customers, offline income and many systems: mini-games, research, a stock exchange, guilds, wars, the 500-play strategy room and more. It needed an always-on host, so it was replaced by v2 to run on Netlify + Supabase only and to make every Bit come from real players. The v1 code is in the git history before the "v2" commits.
