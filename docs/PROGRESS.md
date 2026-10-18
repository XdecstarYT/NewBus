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

## In progress
- Phase 9 - Mini-games, research, achievements, quests, seasons, battle pass.

## Next
- Phases 10-12 per `docs/SPEC.md` section 24.
- Mini-Games / Achievements / Research nav entries are hidden (`UNBUILT` in `GameLayout.tsx`) until Phase 9 ships their pages.

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
