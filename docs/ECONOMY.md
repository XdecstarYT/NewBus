# Digital Workforce: how the economy works

Bits (BT) are fictional. Nothing in the game connects to real money. Every number
below lives in [`apps/server/src/config/economy.ts`](../apps/server/src/config/economy.ts),
and most can be changed live under **Owner Panel → Flags & settings → Live economy settings**.

## The ledger

Every Bit movement is a double-entry ledger post (`ledger_entries`) between wallets.
There are three system wallets:

| Wallet | What it is |
|---|---|
| **MINT** | Where Bits are born and die. It is the only wallet allowed to go negative, so **money supply = −MINT** and the sum of all wallets is always exactly 0. The owner's Ledger page has a "verify" button that checks this. |
| **Treasury** | The game's bank. It pays rewards (contracts, quests, achievements, war and fair prizes, mini-games, Credit Rain, season prizes) and collects wages, upkeep, fees and taxes. |
| **NPC pool** | The money that computer-controlled customers spend in shops. It is refilled a little per active company per tick, up to a cap, so sales can never create unlimited Bits. |

## Where Bits come from (faucets)

| Faucet | Notes |
|---|---|
| Production income (`income.production`) | Workers produce Bits every 5-second tick. Multiplied by level, upgrades, research, decor, guild perks and events. Minted. **Taxed progressively** (see below). Stops after 8 hours offline. |
| Tap-to-boost (`income.boost`) | Small, capped per day. |
| NPC pool refill | Customers' spending money. |
| Starting grants | Set in the Company Builder. |

## Where Bits go (sinks)

| Sink | Notes |
|---|---|
| Wages and upkeep | Every tick, paid to the Treasury. The starter room is upkeep-free, so new companies can't start in the red. |
| Purchases | Pods, upgrades, equipment, decor, marketing, storage, booth fees. (Research costs Research Points, not Bits.) |
| Fees and taxes | Transfer fee, trading fee, marketplace fee, sales tax, wealth tax above a threshold. |
| **Treasury burn** | The Treasury keeps `treasuryReserve` (60M) for rewards. Anything above that is destroyed, so wages and fees are a real sink instead of just piling up. |

## Keeping it balanced

**Progressive production tax.** Income up to `incomeTaxFreePerTick` (12 BT per tick) is untaxed. Above that, `incomeTaxRate` of it is never minted. Small companies pay nothing; runaway empires grow more slowly.

**Auto-balancer** (feature flag `autoBalancer`, **on by default**). Every 15 minutes it measures inflation: how fast the money supply grows per day, excluding the one-off seed funding.

| When inflation is | It does this |
|---|---|
| Above the target band (`inflationTargetHigh`, 5%/day) | Raises the production tax by 5 points (max 85%) and trims the NPC refill. |
| Below the band | Does the opposite. |

Every change is written to the audit log.

> Why not just raise wages? The simulation showed that raising flat wages pushes **half the companies to zero** while the richest keep growing. The progressive tax trims the top instead and leaves small players alone.

**Owner levers.** The Economy page shows supply, inflation, Gini (inequality), velocity, the biggest flows, the richest and poorest, and plain-English suggestions. Chaos Controls (Credit Rain, Double-Bits Hour) are the "fun" levers.

## Simulation

```bash
npm run simulate                                  # 500 bots, 3 days, 1-hour steps
npm run simulate -- --bots 1000 --days 7 --out report.md
npm run simulate -- --no-autobalance              # compare without the auto-balancer
```

The simulation runs on a throwaway in-memory database. It uses five bot play styles:

| Style | Plays like |
|---|---|
| idle | Logs in rarely |
| casual | Plays now and then |
| grinder | Online a lot, taps, upgrades, researches |
| gamer | Plays lots of mini-games |
| builder | Upgrades workplaces and researches |

The report covers:
- money supply, Treasury and NPC pool per day
- median and top-1% balances, and the Gini coefficient
- faucets, sinks and Treasury payouts by type
- results per play style
- ledger integrity
- warnings

Latest results: [SIMULATION.md](SIMULATION.md).

What the simulations found (500 bots each; the money growth column is the growth on the last simulated day):

| Setup | Days | Money growth on the last day | Gini | Median balance | Top 1% balance |
|---|---|---|---|---|---|
| Before the Treasury burn and the tax | 3 | 50.7% | 0.71 | 62k | 1.42M |
| Old auto-balancer (raises flat wages) | 3 | 37.7% | 0.85 | **0** (half the companies broke) | 0.87M |
| Production tax + Treasury burn, auto-balancer off | 3 | 37.7% | 0.67 | 59k | 1.10M |
| **Production tax + Treasury burn + new auto-balancer (default)** | 4 | **1.5%** (day 3: 7.1%) | **0.55** | 57k | 0.31M |

Day 1 always shows big growth because every company starts up at once. Watch the later days and the **last day's money growth** line in the report.

## Load test

```bash
npm run loadtest                                  # 200 players for 30 s
npm run loadtest -- --users 500 --seconds 60
```

This boots a real server with HTTP, WebSockets and the tick engine on a temporary database. Every virtual player logs in, holds a live WebSocket, and loops through the main API calls with human-like pauses. It reports p50/p95/p99 latency per endpoint, errors, requests per second and ledger integrity.
