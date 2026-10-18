# DIGITAL WORKFORCE: MEGA MASTER PROMPT FOR CLAUDE CODE

You are a senior full-stack game developer with a great sense of humor and a love of "juicy" game feel. Build **"Digital Workforce"**, a funny, colorful, addictive, invite-only browser game where players run their own digital companies in 200+ industries, staffed by quirky digital workers, earning a fictional currency called **Bits (BT)**. Companies can list on an in-game stock exchange, trade with each other, take loans, fight friendly business wars and climb seasonal leaderboards. The **OWNER** (the human running the game) creates every company and login from a dashboard, hands the logins out, and controls exactly what each login can access.

Bits are in-game only. No real money, no real crypto, no payments, no real securities, no pay-to-win. Everything is fictional and age-appropriate.

---

## 0. HOW TO WORK (meta-instructions)

1. Save this entire spec to `docs/SPEC.md`. Keep `docs/PROGRESS.md` updated (done / in progress / next / decisions made).
2. Do not ask me questions unless truly blocked. Pick sensible defaults and record them in `docs/PROGRESS.md`.
3. Build in the phases listed in section 24. After each phase: run the app and the tests, fix errors, then give me a 3-line summary.
4. Every major feature sits behind a **feature flag** in the config and in the Owner Panel, so features can be switched on or off live. Ship the core loop first, then expand.
5. Keep the code modular: `routes`, `services`, `engine`, `db`, `catalog`, `permissions`, `exchange`, `ui`. Comment the tricky parts.
6. Put every balance number (rates, fees, odds, caps, prices) in one `config/economy.ts` so it is easy to tune.
7. If a requirement is too big for one go, build a working simple version first and mark the upgrade in `docs/PROGRESS.md`. Never leave a half-wired feature visible to players.

---

## 1. VIBE, THEME AND TONE

- Tone: cheeky, wholesome, lightly satirical office comedy ("Overcooked meets Cookie Clicker meets a cartoon startup").
- Art: bright, chunky cartoon style, rounded shapes, bold outlines, playful palette. Generated with SVG, CSS and emoji (no external assets required). Dark mode toggle plus a few unlockable themes.
- Workers are cute bots, blobs and critters with faces that show their mood, idle animations (typing, napping, spinning, panicking) and speech bubbles with one-liners.
- Mascot **Boss Byte** narrates tutorials, tips, events and market commentary with jokes. Boss Byte reacts to what the player just did.
- Every screen has personality: funny empty states, joke loading screens (10+ per industry), silly confirmation dialogs, and Easter eggs.
- Never let the game feel empty: always show a next goal, a nearly full progress bar and something to claim.

---

## 2. TECH STACK AND ARCHITECTURE

- TypeScript everywhere, in a monorepo: `apps/web`, `apps/server`, `packages/shared` (types, zod schemas, constants).
- Frontend: React + Vite + Tailwind + Framer Motion, React Query for server state, a small store (Zustand) for UI state. PWA installable, mobile-first.
- Backend: Node + Express, `ws` WebSocket for live updates (prices, events, chat, balances).
- Database: SQLite via Drizzle or Prisma with migrations (keep it Postgres-ready). Zero-setup locally.
- **Server-authoritative:** the client never decides balances, permissions, prices, drops or earnings.
- Game engine is a separate pure module (deterministic with a seeded RNG, so it can be unit-tested and simulated).
- Validation with zod on every route and every WebSocket message.
- Tests: Vitest (unit and integration), Playwright (end-to-end).
- Docker + docker-compose for one-command deployment.

---

## 3. ACCOUNTS, ROLES AND LOGIN

Login is **account number + password**, styled as a fun "Employee Badge Scanner" screen. There is **NO public sign-up**. Accounts only exist if the owner (or someone the owner allowed) creates them.

**Account numbers are strings, zero-padded** ("01", "02", ... "10", "11"), never integers, so the leading zero is preserved.

**Roles:**
- `OWNER`: super admin of the whole game. Seeded on first run:
  - Account number: **01**
  - Password: **Diddy**
- `MODERATOR`: created by the owner, gets only the moderation tools the owner enables (mute, kick, review reports, view audit log).
- `COMPANY_ADMIN`: the person running one company (the "CEO"). Created by the owner.
- `STAFF`: sub-accounts inside a company with job titles (CFO, HR, Trader, Operations, Intern). Created by a company admin only if the owner granted that permission.

**Security rules for accounts:**
- Hash passwords with argon2 or bcrypt. Never store plaintext. The seeded owner credentials come from the seed script / `.env` (defaulting to 01 / Diddy as requested), never hard-coded across the code.
- Rate-limit login, lock out after repeated failures (with a timed unlock), httpOnly + SameSite cookies, CSRF protection, helmet headers.
- Per account: `created_by`, `created_at`, `last_login`, `status` (active, suspended, archived), `must_change_password` flag (owner can set it per account), active session list with "force logout".
- Optional TOTP two-factor for the owner account (setup screen in Owner Panel).
- No email needed. Password recovery is the owner resetting it from the dashboard.

---

## 4. OWNER DASHBOARD: SETTING UP COMPANIES (THE CORE FLOW)

The owner opens **Company Builder**, a fun step-by-step wizard:

1. **Company details:** name, logo/emoji, brand color, slogan (with a "Boss Byte suggests one" button).
2. **Pick an industry** from the 200+ catalog: searchable, filterable by category, with a preview card showing its workplaces, worker types, product and sample jokes.
3. **Starting package:** starting Bits, starting workers, starting workplace, difficulty (Chill, Normal, Chaos).
4. **Permissions:** choose a preset (Starter, Standard, Full Access, Read-Only, Custom) or toggle everything by hand (section 5).
5. **Create the login:** auto-generate the next account number (or the owner types a custom one) and a temporary password (or the owner types one). Show a printable and copyable **Welcome Badge** card: account number, temp password, company name, login link. The temp password is displayed only once at creation.
6. **Confirm:** Boss Byte celebrates with confetti and the company appears in the Company List.

**Company List and management (owner only):** search, filter by industry/status/listed-on-exchange, open any company's detail page, edit anything at any time, reset password, suspend/unsuspend, archive, delete (with confirm), clone a company as a template, change industry (with a clear warning of what resets), and **"View as company"**: a read-only preview of exactly what that login sees, clearly bannered, with all actions disabled.

**Bulk actions:** apply a permission template, grant or take Bits, suspend, send a message, or toggle a module across many selected companies at once.

---

## 5. PERMISSION SYSTEM (GRANULAR AND LIVE-EDITABLE)

The owner controls what each login can access. Changes apply **instantly** without re-login. Permissions are enforced on the **server** for every route and every WebSocket message; the UI also hides whatever is not allowed.

**Module toggles per company/account:**
Office, Workforce, Recruit Pods, Contracts, Mini-Games, Bank/Wallet, Loans, Transfers/Gifting, Marketplace, Supply Chain Trade, Products and Sales, Inventory and Warehouses, Marketing, Property, Stock Market (Bit Exchange), Leaderboard, Achievements, Research Tree, Decorations/Pets, IPO/Prestige, Events, Chat/Emotes, Guilds, Business Wars, Daily Byte News, Staff Management.

**Limits per company/account (all optional, owner-editable):**
- Max workers, max workplaces, max workplace tier unlocked
- Max Bits balance cap, daily earn cap, daily spend cap
- Max transfer amount per day, allowed recipients (anyone / same company / nobody)
- Max loan size, max portfolio value, max daily trades, which exchange assets are tradable, shorting allowed (default off)
- Which mini-games are allowed
- Whether the company admin can create STAFF accounts and how many
- Which permissions a company admin may hand down to staff (a company admin can **never** grant more than they have)

**Also:**
- Reusable **permission templates** (create, edit, delete, apply to many companies).
- Per-feature "locked" screens that are funny ("Boss Byte says: ask the Owner to unlock this!") instead of blank errors.
- Full audit log of every permission change: who, what, when, old value, new value.

---

## 6. THE INDUSTRY CATALOG (200+ INDUSTRIES)

Build a data-driven catalog (JSON/TS plus database seed) with **at least these 210 industries** (30 categories x 7). Add more if you like. The owner can add, edit, disable or duplicate industries from the Owner Panel.

1. **Tech and Software:** App Studio, Cloud Hosting, Cybersecurity Firm, AI Lab, Web Agency, Chip Foundry, Robotics Workshop
2. **Gaming and Esports:** Indie Game Studio, Esports Arena, Game Streaming Network, Arcade Empire, VR Playground, Board Game Cafe, Speedrun Academy
3. **Media and Entertainment:** TV Network, Podcast Studio, Newspaper, Comic Publisher, Talent Agency, Theme Park, Circus
4. **Music and Audio:** Record Label, Concert Promoter, Recording Studio, Instrument Maker, DJ Collective, Music Festival, Audiobook House
5. **Film and Streaming:** Movie Studio, Animation House, Streaming Platform, Cinema Chain, Special Effects Shop, Documentary Crew, Drive-In Theater
6. **Fashion and Beauty:** Fashion House, Sneaker Brand, Hair Salon Chain, Cosmetics Lab, Tailor Shop, Jewelry Maker, Perfume Maker
7. **Food and Hospitality:** Pizza Empire, Bakery, Burger Joint, Sushi Train, Taco Truck Fleet, Ice Cream Factory, Five-Star Hotel
8. **Beverages and Cafes:** Coffee Roastery, Bubble Tea Chain, Root Beer Brewery, Grape Juice Vineyard, Juice Bar, Soda Maker, Tea House
9. **Retail and E-commerce:** Online Marketplace, Supermarket, Toy Store, Bookshop, Thrift Shop, Electronics Mart, Flower Shop
10. **Health and Wellness:** Hospital, Dental Clinic, Pharmacy, Yoga Studio, Spa Resort, Vet Clinic, Health Food Co
11. **Science and Research:** Biotech Lab, Weather Station, Ocean Research, Particle Collider, Archaeology Dig, Botanical Institute, Inventor's Garage
12. **Space and Aviation:** Rocket Company, Airline, Satellite Network, Moon Mining, Space Tourism, Airport Services, Drone Delivery
13. **Transport and Logistics:** Courier Service, Trucking Fleet, Shipping Line, Railway, Rideshare, Warehouse Hub, Bike Courier
14. **Construction and Real Estate:** Home Builder, Skyscraper Developer, Real Estate Agency, Interior Design, Architecture Firm, Landscaping, Demolition Derby Co (cartoon)
15. **Agriculture and Farming:** Crop Farm, Dairy Farm, Orchard, Greenhouse, Chicken Ranch, Beekeeping, Hydroponics Tower
16. **Energy and Mining:** Solar Farm, Wind Park, Gold Mine, Gem Cave, Battery Maker, Hydro Dam, Fusion Reactor
17. **Finance (fictional only):** Neighborhood Bank, Insurance Agency, Accounting Firm, Investment House, Pawn Shop, Payment App, Piggy Bank Co
18. **Education:** Primary School, University, Coding Bootcamp, Language Academy, Tutoring Center, Driving School, Library
19. **Government and Public Services (cartoon):** Fire Station, Post Office, Town Hall, Recycling Center, Public Transit Authority, Park Rangers, Lost and Found Office
20. **Sports and Fitness:** Gym Chain, Football Club, Skate Park, Marathon Events, Martial Arts Dojo, Swim School, Climbing Gym
21. **Travel and Tourism:** Travel Agency, Cruise Line, Hostel Network, Tour Guides, Camping Resort, Ski Resort, Island Getaway
22. **Manufacturing:** Toy Factory, Furniture Maker, Textile Mill, Robot Assembly Line, Glassworks, Paper Mill, 3D Print Farm
23. **Automotive:** Car Dealership, Electric Car Maker, Motorbike Shop, Racing Team, Auto Repair Garage, Car Wash Empire, Tire Factory
24. **Pets and Animals:** Pet Shop, Dog Grooming, Animal Shelter, Pet Hotel, Aquarium, Zoo, Horse Stables
25. **Home and Garden:** Hardware Store, Plumbing Co, Cleaning Service, Pool Builders, Garden Center, Smart Home Installer, Moving Company
26. **Legal and Consulting:** Law Firm, Management Consultants, Patent Office, HR Agency, PR Agency, Marketing Agency, Detective Agency
27. **Security and Rescue (cartoon, non-violent):** Security Guards, Lifeguard Co, Search and Rescue, Locksmith, Alarm Systems, Mall Patrol, Paranormal Cleanup Crew
28. **Arts and Crafts:** Art Gallery, Pottery Studio, Sculpture Workshop, Candle Maker, Photography Studio, Print Shop, Street Mural Collective
29. **Events and Weddings:** Wedding Planner, Party Rentals, Catering Co, Fireworks Show, Magic Show Troupe, Trade Show Organizer, Karaoke Bar
30. **Weird and Wacky:** Wizard Tower Support, Dragon Hoard Accounting, Alien Tourism Board, Time Travel Agency, Haunted House Management, Mermaid Cove Resort, Giant Robot Rental

**Every industry entry must include:**
- `id`, name, category, emoji/icon, brand color
- 3 to 5 workplace names with tiers (e.g. Bakery: Garage Oven, Corner Shop, Pastry Palace, Croissant Factory)
- 4 to 6 worker archetypes with funny names, quirks and role bonuses
- Its product line (7 to 10 products, full spec in section 11B), base Bits-per-tick for passive income, and which inputs it needs and which industries it supplies (for supply chain, section 11)
- Industry-specific contracts, random events, mini-game flavor text, 2 to 3 unique upgrades
- 10+ jokes / loading tips

Build the catalog with a generator helper and templates so 210+ entries stay consistent, but give each industry **real flavor**, not just a renamed copy. All industries are balanced through the shared economy config so none is strictly better than another. Add a test that validates the catalog (210+ entries, no missing fields, no duplicate ids, every supply chain reference exists).

---

## 7. CORE GAMEPLAY (PER COMPANY)

- **Recruit Pods:** gacha-style capsule openings with a big animated reveal, rarity glow (Common, Rare, Epic, Legendary, "Cursed Intern"), confetti and a pity timer. Bits only. Odds are shown openly in the UI.
- **Workers:** name, species, personality quirk (e.g. "Procrastinator: 10% chance to nap, 2x output after coffee"), skills, energy, mood (shown on the face), level, rarity, wage. Train, level up, rename, promote, fire, or trade them on the marketplace.
- **Workplaces:** unlock and upgrade through tiers. Drag and drop workers onto desks. Matching worker role to workplace gives a visible **synergy combo** popup.
- **Boosting:** tap/click a workplace to boost it, with floating +BT numbers, coin bursts, screen shake on big hits and combo multipliers.
- **Idle and offline earnings** with a "While you were away..." welcome-back screen, capped at a configurable number of hours.
- **IPO Prestige** (a reset for permanent multipliers and a shiny trophy; separate from the stock market listing but they can feed each other).
- **Daily login streak** with a spin-the-wheel reward.
- **Company level and fame:** levels unlock new workplaces, pod types, decorations and modules (within the owner's permissions).
- **Worker relationships:** some pairs have chemistry (bonus), others rivalry (funny drama events). Optional worker crushes, coffee-break gossip and office pranks.
- **Office customization:** decorations, pets (cat on keyboard, office plant, rubber duck, tiny dragon) with small perks, floor plan editing, wallpapers, desk skins.
- **Company dashboard:** income per tick, wages, upkeep, profit, morale, boredom meter, fire hazards (cartoon), next goals.

---

## 8. ECONOMY

- **Immutable double-entry ledger.** Integer amounts only (never floats). Every Bit movement is a ledger entry between two accounts.
- **Central Treasury** account. Payroll, purchases, rewards, taxes and fees all move between accounts through the ledger.
- All money operations are **atomic** (DB transactions) and **idempotent** (idempotency keys).
- **Server tick** (configurable) drives production, wages, upkeep, interest, dividends and events.
- **Taxes and sinks** (configurable, owner-editable): small transaction fee, optional wealth tax above a threshold, upkeep, pod costs, cosmetic shops. Tax revenue funds Treasury events like Credit Rain.
- **Economy health monitor** in the Owner Panel: total supply, Gini coefficient, inflation gauge (Bits created vs destroyed per day), richest and poorest, velocity of money, and suggested tuning ("Boss Byte says: too many Bits! Raise upkeep by 5%.").
- **Auto-balancer (optional flag):** nudges sinks and faucets to keep inflation in a target band.
- Wallets show full history with filters. Gifting and transfers follow owner permissions, daily limits and fees.

---

## 9. BANKING AND FINANCE (FICTIONAL)

- **Bit Bank:** savings accounts with configurable interest, term deposits (lock for more interest), and a company wallet with sub-pots (Payroll, Savings, Investing).
- **Loans:** companies borrow from the Treasury or from other players (peer lending). Credit score based on repayment history. Interest, repayment schedule, late fees, defaults that hurt credit and morale. Owner can cap or forgive loans.
- **Insurance:** optional policies against bad events (Server on Fire, Audit, Market Crash) with premiums.
- **Payroll for STAFF accounts:** a company admin can pay staff salaries or bonuses in Bits through the ledger (within the owner's limits).
- **Invoices and contracts between companies:** send invoices, accept/reject, escrow for big trades.
- **Bit Lotto and Lucky Wheel (fun, capped):** tickets cost Bits only, daily ticket caps, odds shown, owner can switch off. No real money, ever.

---

## 10. THE BIT EXCHANGE (DIGITAL STOCK MARKET)

A fun, in-game stock market where listed companies trade shares for Bits. Fictional only.

**Listing (owner-controlled)**
- A company can only list if the owner enables the "Stock Market" module for it and approves its IPO. The owner sets share count, starting price and the % held by the founder.
- A company admin can request an IPO from Company Settings; the owner approves or rejects. The owner can delist or halt trading anytime.
- Founders must keep a minimum % of shares (configurable). Lock-up window after IPO (configurable).

**Price mode (owner chooses, switchable per company or globally):**
1. **Player-driven:** a central order book (market and limit orders) with supply and demand.
2. **Fundamentals-anchored (default):** price is pulled gently toward a fundamental value computed from the company's **real activity** (Bits earned per tick, net worth, growth rate, worker count, contracts completed, credit score). Real players who keep growing see their stock climb.
3. **Owner-controlled:** the owner sets prices directly.

**Assets beyond stocks:**
- **Index funds / ETFs:** "Bit500" (top 500 by market cap), industry indexes (Food Index, Tech Index, Weird and Wacky Index).
- **Bonds:** companies and the Treasury issue bonds with fixed interest.
- **Commodities:** fictional goods (Bytes of Flour, Barrels of Coffee, Moon Rocks) tied to real supply and demand from supply chain activity.
- **Fictional coins:** wacky volatile "meme coins" (DuckCoin, PizzaCoin) that pump and dump on random events. Strictly fictional, with caps.
- **Options, shorting and margin:** off by default; owner can enable with strict limits.

**Compounding**
- Listed companies pay **dividends** each payout period (configurable % of profit) to all shareholders through the ledger.
- Players can toggle **auto-reinvest (DRIP)** to buy more shares with dividends.
- Shareholder **board votes:** shareholders vote on proposals (dividend size, buyback, new workplace) with weight by shares.
- **Buybacks, stock splits, and takeovers** (a buyer who passes a configurable ownership threshold can propose a takeover, subject to owner approval).

**UI**
- Candlestick and line charts, volume, 24h and 7d change, market cap, order book depth, heat map of the whole market, watchlists, price alerts, and a **ticker tape with Boss Byte commentary** ("Pixel Studio is MOONING!").
- Portfolio page: holdings, cost basis, profit/loss, dividend history, net worth over time, diversification score.
- Random market events (Bull Run, Bubble Pop, Audit Scare, Viral Meme Rally, Supply Shock). Owner can trigger them from Chaos Controls.

**Fairness and anti-exploit**
- Trading fee to the Treasury. Block wash trading and self-dealing (including between accounts the owner flags as linked). Cap order sizes. Daily price move limits (circuit breakers). Trade halt on suspicious spikes.
- No trading your own company's shares during the lock-up window.
- All trades and dividends go through the double-entry ledger, atomic and idempotent. Every trade is written to the audit log.

**Owner Panel "Market" tab:** list/delist, halt trading, set fees, limits and price mode, issue bonds, create indexes, view the full order book and trade history, flag suspicious activity, export CSV.

**Exchange permissions:** module toggle, max portfolio value, max daily trades, which assets a player can buy, shorting yes/no.

---

## 11. SUPPLY CHAIN, MARKETPLACE AND CONTRACTS

- **Supply chain trade:** industries need inputs from other industries (Bakery needs Flour from Crop Farm, Sushi Train needs Fish from Aquarium-type suppliers). Companies can buy inputs from other players or from an NPC wholesaler at a worse price. Missing inputs slow production. Player-to-player supply deals earn both sides a bonus.
- **Marketplace and auction house:** workers, decorations, pets, supplies and cosmetic items. Listings, bids, buy-it-now, small fee to the Treasury, anti-scam protections, price history.
- **Contracts board:** timed jobs with bonus objectives, NPC clients with personalities, industry-specific contracts, and company-to-company contracts with escrow.
- **Trade fairs:** limited-time events where companies showcase products for bonus Bits and reputation.

---

## 11B. PRODUCTS, SERVICES, INVENTORY, CUSTOMERS AND SALES

Companies make and sell real things, so every industry feels different. Passive "Bits per tick" income is only the baseline; the money game is products, prices and customers.

**Product catalog**
- Every industry defines **at least 7 products** (1,470+ total, aim for 8 to 10), generated from templates but with real flavor. Examples: Bakery: Sourdough Loaf, Choc Croissant, Birthday Cake, Wedding Cake. Space Tourism: Moon Postcard, Orbit Day Trip, Luxury Lunar Suite. Toy Factory: Rubber Duck, Robot Buddy, Limited Edition Plushie.
- Each product has: id, name, emoji, industry, category, tier (Basic, Good, Premium, Luxury, Legendary), base cost, base price, production time, quality range, shelf life (perishable or not), demand curve, seasonality, rarity, unlock level, required workplace, and recipe (inputs).
- Fictional only: no real brands, and nothing age-inappropriate (no alcohol, tobacco or weapons).

**Production**
- Workplaces run **production queues**: queue products, assign workers to speed them up. Quality depends on worker skill, morale, equipment and input quality.
- Recipes consume inputs from the supply chain (section 11) and support intermediate goods (flour to dough to bread).
- **Equipment and machines** (ovens, 3D printers, looms) to buy and upgrade, with speed, capacity and quality bonuses, plus maintenance and funny breakdowns.
- Funny "oops" outcomes on failures (burnt croissant becomes "charcoal art" and sells to Critics).
- Automation upgrades so idle play keeps queues running.

**Inventory and warehouses**
- Warehouses with capacity and upgrade tiers, stock tracking, spoilage for perishables, storage costs, cartoon pest events, low-stock alerts and auto-restock rules.

**Pricing and selling**
- Players set their own price per product. Demand reacts to price, quality, brand reputation, marketing, season, events and competition from other companies in the same industry. A **demand meter** and Boss Byte price tips guide the player.
- **Sales channels:** shopfront (walk-in customers), online store, wholesale to other players, contracts, trade fairs, pop-up stalls, marketplace.
- **NPC customers** with personalities and budgets (Bargain Hunter, Trend Chaser, Big Spender, Grumpy Regular, Influencer, Tourist, Critic) shown as little characters visiting the shop, with queues and satisfaction.
- **Reviews and ratings:** funny star reviews that affect demand. Companies can reply. Review-bomb events are owner-togglable.
- **Brand and reputation:** brand level, loyalty programs, coupons, sales, limited drops and flash sales.
- **Marketing:** ad campaigns (billboard, social, influencer, radio) with a Bits budget, ROI tracking and a campaign mini-game.
- **Product lifecycle:** R&D to launch new products (linked to the research tree), daily trending items, fads, collector's editions, discontinued items and product recalls (as events).
- **Customer service:** a complaints mini-game that protects ratings.

**Services and appointments (for service industries)**
- Hair Salon, Dental Clinic, Law Firm and similar sell **services** instead of goods: appointment slots, staff capacity, wait times, service quality, recurring clients and subscriptions or memberships (Gym Chain, Streaming Platform).

**Property and assets**
- Companies can buy **buildings and land plots** (shopfronts, warehouses, offices) in themed districts. Location affects foot traffic. Owned property saves rent; spare property can be rented to other players. Property values rise and fall with the area's activity.
- **Fleet and vehicles** for logistics-heavy industries (trucks, vans, bikes, ships) that speed delivery and cap shipping volume.

**Market data**
- Product price index, trending-products board, Top Sellers leaderboard per industry, price history charts. NPC wholesalers set price floors and ceilings so nobody can exploit the market.
- Exchange commodities (section 10) track real product supply and demand.

**Accounting**
- Every sale goes through the ledger (customers pay from a funded **NPC demand pool** account to the company). Sales tax goes to the Treasury.
- **NPC demand is budgeted** by config and scales with active players, so Bits creation is bounded and the economy cannot inflate out of control. Owner can edit it live.
- Each company gets **financial statements**: revenue, cost of goods, gross margin, expenses, profit and a balance sheet. These feed the stock's fundamental value on the Bit Exchange.

**Owner controls**
- **Product Catalog manager:** add, edit, disable or duplicate products, bulk import/export as JSON or CSV.
- Global demand multipliers, price floors and ceilings, trigger trends, fads and recalls, view top sellers, and flag exploit loops (buy-low-sell-high cycles).
- **Permissions:** Products module, max products listed, max warehouse level, allowed sales channels, price limits, and whether the company may sell to other players.

---

## 12. SOCIAL, GUILDS AND BUSINESS WARS

- **Guilds / alliances:** create or join, shared treasury (owner-limited), guild perks, guild chat, guild leaderboards, guild quests.
- **Business Wars (non-violent, friendly rivalry):** company-vs-company and guild-vs-guild contests such as market-share battles, hackathons, bake-offs and sales sprints, scored on real in-game performance over a set time window. Winners earn Bits, trophies and bragging rights; losers get consolation prizes. Owner can schedule or disable them.
- **Chat and emotes:** company chat, guild chat, global chat, DMs, all owner-controlled per permission. Profanity filter, mute, block, report button, moderator tools, chat rate limits, and slow mode.
- **Profiles:** company profile pages (logo, industry, level, achievements, stock ticker, trophies), player titles and badges.
- **Emote reactions** to other companies' achievements and big stock moves.
- **Mentorship:** veteran players can mentor newcomers for small rewards (owner-togglable).

---

## 13. PROGRESSION AND CONTENT

- **Research tree:** spend Bits and research points on branches (Efficiency, Marketing, Automation, Culture, Finance) for permanent perks.
- **Achievements:** hundreds, with silly titles ("Middle Manager of Chaos", "Spreadsheet Wizard", "Diamond Hands", "Bought the Dip", "Dividend Dynasty") and unlockable badges.
- **Daily, weekly and seasonal quests** with a progress tracker.
- **Seasons:** each season has a theme, a leaderboard reset, cosmetic rewards, and an optional **free battle pass** (cosmetics only, no pay-to-win, no real money).
- **Leaderboards:** global, per industry, per guild, richest investor, best-performing stock, fastest-growing company, most generous gifter.
- **Collections:** worker collection book, pet collection, decoration sets with set bonuses.
- **Hall of Fame:** permanent record of past season winners.

---

## 14. MINI-GAMES (12, ALL PAY BITS, WITH DAILY CAPS)

Reskinned per industry where possible:
1. Debug Rush (click the bugs)
2. Coffee Run (timing game)
3. Email Sorter (swipe left/right)
4. Meme Maker (match pairs)
5. Server Whack (whack-a-mole style)
6. Invoice Match (memory)
7. Stock Sprint (guess up or down, fictional)
8. Box Stack (stacking)
9. Pizza Rush (order assembly)
10. Parking Panic (traffic puzzle)
11. Cable Untangle (puzzle)
12. Quiz Show (trivia with Boss Byte as host)

Owner can enable/disable each mini-game per company and set payout caps. Anti-cheat: server validates scores against plausible time and input limits.

---

## 15. EVENTS AND NEWS

- **Random office events** with choices and consequences: Free Pizza Friday, Server on Fire, Printer Jam Minigame, Surprise Audit, Viral Meme Boom, Coffee Machine Breakdown, Rogue AI Intern, Power Outage, Office Dog Escapes. Plus industry-specific events.
- **Global events:** Credit Rain, Double-Bits Hour, Market Crash, Boom Week, Holiday specials (seasonal themes).
- **The Daily Byte:** an in-game newspaper with auto-generated headlines about real activity ("Taco Truck Fleet overtakes Pizza Empire!", "Stock market hits record high"), market reports, funny classified ads and a weekly column by Boss Byte.
- **Notification center:** claimable rewards, loan due dates, price alerts, contract updates, chat mentions, event alerts. Push notifications for the PWA (opt-in).

---

## 16. JUICE, SOUND AND FEEL

- Floating numbers, particles, coin bursts, confetti, screen shake, combo meters, squash-and-stretch buttons, smooth rolling balance counters, satisfying pod reveals.
- Sound via Web Audio (coin pings, level-up jingles, clicks, pod reveal drumroll). Background music toggle, separate volume sliders, mute.
- Haptic-style animation feedback everywhere, and real vibration on mobile where supported (opt-in).
- Respect a **reduced motion** setting that tones all of this down.

---

## 17. OWNER CONTROL PANEL (OWNER ONLY)

- **Overview:** total Bits supply, Treasury, companies by industry, active players, ledger activity, exchange stats, economy health.
- **Company Builder and Company List** (section 4), **Permission Templates** (section 5), **Industry Catalog manager** (section 6), **Product Catalog manager** (section 11B).
- **Accounts manager:** all accounts across all companies, reset passwords, suspend, change roles, force logout, last login, linked-account flags.
- **Money tools:** mint, burn, grant or take Bits for any company, with a reason saved to the audit log. Forgive loans. Refund trades.
- **Chaos Controls:** trigger any event for one company or all, Credit Rain, global Double-Bits Hour, spawn a Legendary worker, market crash or boom, broadcast a message from Boss Byte, start a Business War.
- **Live economy settings:** tick rate, fees, taxes, event frequency, pod odds, interest rates, dividend rates, price mode.
- **Feature flags:** switch any module on or off globally.
- **Season manager:** start/end seasons, reset leaderboards, award prizes, archive to Hall of Fame.
- **Announcements and maintenance mode:** banner messages, scheduled maintenance, read-only mode.
- **Moderation center:** reports queue, mute/ban, chat logs, appeal notes.
- **Ledger viewer** with filters and CSV export, **audit log viewer**, **trade history viewer**.
- **Backups:** one-click database backup and restore, scheduled automatic backups, export/import of the whole game config (industries, templates, settings) as JSON.
- **Anti-cheat dashboard:** suspicious transfers, wash trades, mini-game score outliers, multi-account detection, rapid-fire requests.
- **Analytics:** daily active companies, retention, popular industries, most-used modules, average session length (anonymous, in-game only).
- **Simulation tool:** run the bot economy simulation (section 21) and view results.

---

## 18. UI/UX, ACCESSIBILITY AND PAGES

**Pages:** Badge Login, Office, Workforce, Recruit Pods, Contracts, Mini-Games, Bank, Loans, Marketplace, Supply Chain, **Bit Exchange**, Portfolio, Guilds, Business Wars, Leaderboard, Achievements, Research, Daily Byte, Chat, Profile, Settings, Company Settings (company admins, limited to what the owner allows), Owner Panel.

**UX rules:**
- Navigation shows **only** the modules the login is allowed to use.
- Mobile-first, big tap targets, installable PWA, works on phones, tablets and desktops.
- Live rolling balance counter, joke toasts, interactive tutorial led by Boss Byte (adapts to enabled modules, skippable, replayable).
- **First login flow:** Badge Scanner, welcome animation with company name and industry, forced password change if the owner set it, then the tutorial.
- **Accessibility:** keyboard navigation, screen-reader labels, colorblind-safe palettes, high-contrast mode, text size setting, reduced motion, captions for audio cues.
- **Localization-ready:** all text in translation files (English first).
- Helpful empty states, undo for risky actions where possible, and confirm dialogs for anything that costs lots of Bits.

---

## 19. SAFETY AND FAIR PLAY

- Anti-multi-account: owner-flagged linked accounts, transfer restrictions between linked accounts, wash-trade blocking.
- Chat safety: filter, reporting, moderators, owner kill switch for chat.
- No pay-to-win, no real money. Pod odds visible. Pity timers. Gambling-style features have daily caps and can be switched off.
- Age-appropriate content: cartoon, non-violent, no real-world brands or real securities.
- Server-side validation on every action; nothing the client sends is trusted.

---

## 20. SECURITY

- argon2/bcrypt, rate limiting, lockouts, CSRF, helmet, strict CORS, input validation (zod), parameterized queries only, output escaping.
- Permission checks in middleware on every route and WebSocket message, with deny-by-default.
- Idempotency keys on all money operations. Row-level locking or serialized transactions on balance changes.
- Secrets in `.env`, never in the repo. `.env.example` included.
- Session management: expiry, rotation on login, force-logout, device list.
- Audit log is append-only.
- **Reminder in the README:** the default owner password (Diddy) is weak and guessable. Change it before putting the game on the internet.

---

## 21. QUALITY AND TESTING

- **Unit tests:** ledger integrity (sum of all accounts is always zero), auth, permission enforcement (including "company admin can't grant more than they have" and live permission changes), pod odds and pity timers, production math, offline earnings caps, loan interest, catalog validity (210+ entries, no duplicates), supply chain references.
- **Product and sales tests:** recipe consumption, inventory never goes negative, spoilage, demand falls as price rises, price floors and ceilings hold, no infinite-money loop across buy/sell chains, NPC demand pool never overspends, ledger balances after thousands of sales, product catalog validity (1,470+ products, no missing fields, every recipe input exists).
- **Exchange tests:** order matching, price calculation in all three modes, dividend payouts, DRIP, wash-trade blocking, circuit breakers, ledger integrity after **thousands of random trades**.
- **Integration tests:** owner creates company, permissions apply, login works, restricted module returns 403, "View as company" is read-only.
- **End-to-end (Playwright):** log in as 01 / Diddy, build a company, log in as it, play the core loop, open a pod, trade a stock.
- **Economy simulation:** a script that runs 500+ bot companies over simulated weeks and reports inflation, wealth distribution and whether any industry or strategy is overpowered. Use the results to tune `config/economy.ts`.
- **Load test** of the tick engine and WebSocket broadcasting.
- Seeded RNG so every test is reproducible.

---

## 22. DEVOPS

- `Dockerfile` and `docker-compose.yml` (app, optional reverse proxy). One command to run.
- Health-check endpoint, structured logging, graceful shutdown.
- Scheduled DB backups with retention.
- GitHub Actions CI: lint, typecheck, test, build.
- Migration scripts and a seed script that creates owner **01**, a few demo companies across different industries, permission templates, and sample market data.

---

## 23. DELIVERABLES

- Working app in the monorepo, with `README.md` (setup, run, deploy, owner guide, how to change the owner password), `.env.example`, `docs/SPEC.md`, `docs/PROGRESS.md`, `docs/ECONOMY.md` (all balance numbers explained), `docs/OWNER_GUIDE.md` (how to build companies, set permissions, run the exchange).
- Database schema covering at least: accounts, sessions, companies, industries, permissions, permission_templates, workers, workplaces, ledger_entries, wallets, audit_log, loans, savings, products, recipes, inventory, warehouses, customers, sales_orders, reviews, campaigns, properties, vehicles, orders, trades, holdings, dividends, assets, indexes, guilds, wars, chat_messages, reports, achievements, quests, seasons, notifications, feature_flags.

---

## 24. BUILD PHASES

1. **Foundation:** monorepo, DB, migrations, auth, roles, sessions, ledger, permission engine, audit log.
2. **Owner Dashboard:** Company Builder wizard, Company List, permission templates, Welcome Badge, View-as-company, bulk actions.
3. **Industry catalog and world:** all 210+ industries, office, workers, workplaces, tick engine, offline earnings.
4. **Core gameplay:** recruit pods, synergy, boosting, contracts, events, daily streak, IPO prestige, decorations and pets.
5. **Economy extras:** bank, savings, loans, credit score, insurance, payroll, taxes, economy health monitor.
6. **Products, supply chain and marketplace:** product catalog (1,470+), production queues, equipment, inventory and warehouses, pricing, NPC customers, reviews, marketing, services, property, inputs, trade, auction house, invoices, trade fairs, financial statements.
7. **The Bit Exchange:** stocks, order book, three price modes, dividends, DRIP, indexes, bonds, commodities, fictional coins, board votes, charts, portfolio, Market tab.
8. **Social:** chat, emotes, guilds, business wars, profiles, leaderboards, Daily Byte news, notifications.
9. **Mini-games and progression:** all 12 mini-games, research tree, achievements, quests, seasons.
10. **Juice and polish:** animations, sounds, particles, PWA, accessibility, localization, tutorial.
11. **Owner extras:** chaos controls, season manager, moderation, backups, anti-cheat dashboard, analytics, simulation tool.
12. **QA and ship:** full test suite, economy simulation and tuning, Docker, CI, README and docs.

After each phase: run the app and tests, fix errors, 3-line summary.

---

## 25. DEFINITION OF DONE

`npm install && npm run seed && npm run dev` starts the game.

I can:
1. Log in as **01 / Diddy** and open the Owner Dashboard.
2. Run the Company Builder to create a company in any of the 210+ industries, set its permissions, and get a Welcome Badge with login details.
3. Log in as that company and see **only** the modules I allowed. Changing permissions from the owner account updates what it sees **immediately**.
4. Play: open a Recruit Pod with a big reveal, place workers on desks, play a mini-game, finish a contract and watch Bits roll in with sounds and confetti.
5. Approve the company's IPO, watch its stock appear on the Bit Exchange, buy shares from another account, receive a dividend and see it auto-reinvest.
6. Make products, set prices, serve NPC customers and read their reviews, take a loan, trade supplies with another company, join a guild and win a Business War.
7. Use Chaos Controls (Credit Rain, market boom) and see every player react live.
8. See clean economy health stats, a full audit log and ledger export.

All tests pass, the ledger always balances, and the economy simulation shows no runaway inflation or overpowered industry.
