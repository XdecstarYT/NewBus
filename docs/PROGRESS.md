# Digital Workforce - Progress

## Done
- **Phase 1 - Foundation:** npm-workspaces monorepo (`apps/server`, `apps/web`, `packages/shared`), SQLite + Drizzle schema & migrations, auth (bcrypt, lockout, session rotation, CSRF double-submit, helmet, strict CORS, rate limits, TOTP for owner), roles, double-entry ledger (MINT/TREASURY/NPC pool), permission engine (flags x company x staff, deny-by-default), append-only audit log.
- **Phase 2 - Owner Dashboard:** 6-step Company Builder with Welcome Badge (print/copy, password shown once), Company List (search/filters), Company Detail (edit, permissions editor, reset password, force logout, suspend/archive/delete, clone-as-template, change industry with warning, money tools), View-as-company (read-only, bannered), bulk actions, permission templates, accounts manager (linked-account groups, moderators), feature flags + live economy settings, ledger viewer + CSV, audit viewer + CSV.
- **Phase 3 - Catalog & world:** 210 industries (30 categories x 7) with hand-written flavour + generator, 1,680 products, 40 commodities, office with drag-and-drop desks, workers with species/quirks/mood faces, workplaces & tiers, tick engine (5s), offline earnings capped at 8h with "While you were away" screen.
- **Phase 4 - Core gameplay:** Recruit Pods (odds shown, pity timers, big reveal), synergy combos, tap-to-boost with combos and daily cap, contracts board (speed bonus), random office events with choices (spec events + industry + drama events from worker relationships), daily streak Lucky Wheel, IPO Prestige, decor/pets shop with set bonuses, unlockable themes.

## In progress
- Phase 5 - Economy extras.

## Next
- Phases 6-12 per `docs/SPEC.md` section 24.

## Decisions / defaults
- **SQLite via better-sqlite3 (synchronous).** Every service call runs to completion; `atomic()` wraps multi-step writes in a real transaction. Schema stays Postgres-ready (text ids, integer money, JSON as text).
- **Money supply** = `-balance(MINT)`. Only MINT may go negative, so the sum of all wallets is always exactly 0.
- **Passive production income** is minted (faucet) and bounded by the offline cap; wages/upkeep/purchases flow to the Treasury (sink). Rewards (contracts, events, wheel) are paid from the Treasury. NPC customer purchases come from the budgeted NPC pool.
- Account numbers are strings; auto-numbering = highest numeric + 1, zero-padded to 2 digits.
- Owner credentials come from `.env` (`OWNER_ACCOUNT_NUMBER`/`OWNER_PASSWORD`, default `01`/`Diddy`) and only at seed time.
- Tick = 5 s. Fractional Bits are carried between ticks in memory (lost on restart - at most 1 BT per company).
- Fonts: system rounded fonts only (no external assets).
- `legacy-peer-deps=true` in `.npmrc`: npm's arborist crashes on Vite 7's optional peer graph inside workspaces. Remaining `npm audit` notes are dev-only build tools (tailwind 3's `braces`, drizzle-kit's esbuild).
