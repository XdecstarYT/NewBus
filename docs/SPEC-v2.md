# Digital Workforce Live (v2): a player-run economy

**Hosting:** Netlify (pages + serverless API) and Supabase (Postgres + Realtime). No other servers.
**Rule of the game:** every Bit and every item comes from a real player doing something. Nothing earns while you are away, and there are no NPC customers buying your stuff. If you want money, another player has to want what you make.

## Who plays
- **The Owner** (account `01`, password from `OWNER_PASSWORD`, default `Diddy`). The Owner runs the world: creates companies, holds the **Treasury**, sets taxes, judges court cases, audits companies and proposes laws.
- **Companies.** Each company has an admin login and can add staff logins for friends. Every login is a real person with their own **Energy**.

## Money (Bits)
- **Ways Bits come into the game:**
  - The starting grant when the Owner creates a company (default 2,000).
  - Owner grants and stimulus payments from the Treasury.
  - Real-life QR reward codes.
  - The Owner minting new Bits on purpose.
- **Ways Bits leave the game (sinks):**
  - Sales tax (default 5%) on every market, shop and POS sale, paid to the Treasury.
  - Building and upgrade costs.
  - Fines and court fees.
- **The ledger:** every movement is a double-entry ledger row, and wallet balances can never go negative.

## Energy and work (active play only)
- **Energy:** each player has 0–100 Energy, refilling at +10/hour. That refill only lets you act; it never produces anything by itself.
- **Working a shift:** spend Energy at one of your company's facilities to run a recipe. It's instant: the inputs leave the company inventory and the outputs arrive.
- **Tools:** with tools in stock, shifts make +50% output. Each Tools item lasts 10 batches.
- **Food:** eat it from company stock to get Energy back (🍞 +15, 🥐 +25, ☕ +30).

## Items and facilities
| Tier | Items |
|---|---|
| Raw | 🌾 Wheat, 🫘 Coffee beans, 🪨 Ore, 🪵 Wood, ☁️ Cotton, 🥛 Milk |
| Processed | 🌫️ Flour, 🟤 Roasted coffee, 🔩 Steel, 🟫 Planks, 🧵 Fabric |
| Goods | 🍞 Bread, 🥐 Pastry, ☕ Latte, 🔨 Tools, 🪑 Furniture, 👕 Uniforms, 📱 Gadget |

- **Facilities:** Farm, Plantation, Mine, Forest, Mill, Roastery, Foundry, Sawmill, Loom, Bakery, Café, Workshop, Furniture Studio, Tailor and Electronics Lab.
- **Starting facility:** a company starts with one, its industry, for free.
- **More facilities:** extra ones cost Bits plus planks and steel.
- **Upgrades (level 1–5):** each level gives more output per batch and needs Bits, planks, steel and tools.

## What goods are for (why players buy from each other)
- **Food** restores Energy, and everyone needs Energy.
- **Tools** boost output and wear out.
- **Planks and steel** are needed for every new facility and every upgrade.
- **Office installs:** furniture, uniforms and gadgets are installed in your office.
  - Furniture adds max Energy for the whole team.
  - Uniforms add Energy regen.
  - Gadgets add prestige.
  - Everything installed counts toward **prestige**, the main leaderboard.

## Trading (all player to player)
- **Market:** an order book per item with buy and sell limit orders. Funds and items are held in escrow, and the price is the maker's.
- **Shops:** list items at your own prices. Players buy instantly or order for pickup. The **POS register** shows a QR code and a 6-letter code to charge someone in person.
- **Transfers:** send Bits or items to another company.

## Politics and justice (all real players)
- **Unions:** members, one rep per company, elected President / Vice President / Treasurer, dues, a treasury, grants, votes of no confidence and union votes on laws.
- **Laws:** the Owner proposes and companies vote. Possible laws:
  - change the sales tax
  - a stimulus payment from the Treasury
  - an Energy-regen boost for a while
  - an amnesty
- **Court:** company v. company or the State v. a company. Evidence, settlements, an Owner verdict and one appeal. Remedies are damages, fines, asset freezes and feature suspensions.
- **Tax audits:** the Owner reviews a company's books (trades, transfers, untaxed income) and can fine or sue.

## Social
- **Chat:** global, company, union and direct messages.
- **Also:** notifications, a news feed made from real events, and leaderboards (net worth, prestige, production).

## Tech
- **Database:** Supabase Postgres, schema `live` (RLS on, no public API access). Migrations are in `supabase/migrations`.
- **API:** `apps/api` holds the TypeScript services, Drizzle and postgres.js. It's served by the Netlify Function `netlify/functions/api.mts` on `/api/*`, and the pages and API share one origin, so cookies just work.
- **Realtime:** the API calls `realtime.send` inside its transactions. Browsers subscribe with the public key and receive only "something changed" hints, then refetch through the API.
- **Timed things** (elections, hearings, appeal windows, expiring sales) are settled whenever someone uses the API, and by a scheduled Netlify function every 10 minutes.
- **Tests:** they run against PGlite, which is Postgres in-process.
