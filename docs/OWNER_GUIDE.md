# Owner guide

You are the Owner. You create every company and login, decide what each one can do,
and keep the game fun and fair. Everything happens in the **Owner Control Panel**
(log in with your owner badge, `01` by default).

> First thing: change the default password "Diddy". In production the game forces
> you to on the first login; otherwise use **🔑 My account**. Turn on two-factor
> login codes there too.

## Getting players in

1. **🧱 Company Builder**: name, logo, colour and slogan, then pick one of 210 industries and a starting package (Bits, workers, difficulty). Then set permissions (a preset or a custom selection) and the login (auto account number + auto password, or your own).
2. **Welcome Badge**: print or copy it and hand it over. The password is shown **once**, and the player must change it on their first login.
3. Players open the game's address on any phone or computer. On phones: **Add to Home Screen** turns it into an app.

## Day-to-day

| Tab | What it's for |
|---|---|
| 🏠 Overview | Live numbers: players online, money supply, today's activity, Boss Byte's tip. |
| 🏢 Companies | Edit, permissions (live, no re-login needed), reset password, force logout, suspend/archive/delete, **view as** (see exactly what they see, read-only), bulk actions, money tools. |
| 📊 Economy | Inflation, inequality, faucets and sinks, suggestions. The auto-balancer is on by default (see [ECONOMY.md](ECONOMY.md)). |
| 📈 Market | Approve IPOs, halt or delist stocks, price modes, bonds, index funds, market events. |
| 🤝 Social | Business Wars, trade fairs, guilds, Daily Byte generators. |
| 🌪️ Chaos & Seasons | Credit Rain, Double-Bits Hour, summon a Legendary, crash or boom, Boss Byte broadcasts, office events; start and end **seasons** (season pass, prizes, Hall of Fame). |
| 🧮 Analytics | Active players (today, 7 and 30 days), daily activity charts, popular industries, feature usage. |
| 🕵️ Anti-cheat | Flags (impossible mini-game scores, rapid-fire requests and more), accounts sharing an IP, linked accounts, big gifts, arcade outliers. |
| 💾 Backups | Back up now, download, **restore** (a safety backup is taken first), automatic backups every `BACKUP_EVERY_HOURS`; export and import your settings file. |
| 📦 Packages | Real-life QR cards that players scan to unbox rewards. |
| 🛡️ Moderation | Reports queue, live chat with delete, chat logs, mutes and kicks, audit log. You can create Moderator accounts with just the tools you choose. |
| 📚 Catalog | Edit industries and products, import and export CSV. |
| 📋 Templates / 🪪 Accounts | Permission presets; every login (staff, moderators, linked-account groups). |
| 🎚️ Flags & settings | Switch whole features on or off for everyone, tune economy numbers live, announcement banner, maintenance (read-only) mode, chat kill switch. |
| 📒 Ledger / 📝 Audit | Every Bit movement (with an integrity check) and every owner action, both exportable as CSV. |

## Permissions in one minute

What a login can use = **global feature flag** AND **company module** AND (for staff) the **staff toggle**. Anything not switched on is off. Company admins can share their own permissions with staff, but never more than they have. Limits (daily earn and spend caps, max workers, max balance, allowed mini-games, sales channels and more) apply on top. Changes take effect immediately, including over the live connection.

## Keeping it healthy

- **Every morning:** glance at Overview and Anti-cheat.
- **Weekly:** check Economy. Start a new season every couple of weeks to keep things fresh.
- **Before big changes:** 💾 Back up now.
- **If something breaks:** turn on maintenance mode (Flags), fix it, restore a backup if needed, then turn maintenance off.

## For the tech-minded

| Command | What it does |
|---|---|
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Browser tests: desktop, phone and accessibility scans |
| `npm run simulate` | 500-bot economy simulation |
| `npm run loadtest` | Load test with live WebSockets |

Hosting: see the README (Render blueprint, Docker Compose, home Wi-Fi).
