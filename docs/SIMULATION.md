# Economy simulation

500 bots · 4 simulated days · 60-minute steps · auto-balancer ON · setup 2.2s · run 688.0s

| Day | Money supply | Treasury | NPC pool | Median balance | Top 1% balance | Gini |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 55,750,000 | 50,000,000 | 5,000,000 | 1,500 | 1,500 | 0.00 |
| 1 | 82,825,489 | 59,992,050 | 5,199,654 | 32,923 | 86,904 | 0.31 |
| 2 | 95,606,849 | 59,992,310 | 5,297,014 | 52,144 | 162,273 | 0.41 |
| 3 | 102,367,460 | 59,987,860 | 5,392,774 | 56,962 | 237,126 | 0.47 |
| 4 | 103,884,280 | 59,985,600 | 5,488,924 | 56,698 | 306,666 | 0.55 |

**Last day's money growth (steady state):** 1.48%
**Average over the whole run:** 16.84% per day (day 1 includes every company starting up at once)
**Target band:** -1.0% to 5.0% per day
**Final tuning:** production tax 85% above 12 BT/tick, wageRatio 0.3, NPC refill 10/company/tick.
**Ledger:** sum of all wallets = 0, 0 mismatches.

| Play style | Bots | Avg balance | Avg level |
|---|---:|---:|---:|
| idle | 121 | 53,550 | 3.5 |
| casual | 196 | 70,623 | 5.4 |
| grinder | 62 | 121,789 | 7.8 |
| gamer | 72 | 20,209 | 5.8 |
| builder | 49 | 185,349 | 7.4 |

**Bits created (faucets):** income.production 235,907,579 · grant.start 750,000 · faucet.npc_refill 488,924 · income.boost 363,812

**Bits removed to the Treasury (sinks):** cost.wages_upkeep 198,439,457 · cost.storage 5,479,579 · spend.workplace_upgrade 1,513,617 · spend.pod 958,000

**Paid out by the Treasury:** sink.burn 188,626,035 · reward.contract 5,911,964 · reward.achievement 1,164,270 · reward.quest 437,646 · reward.minigame 265,138

Actions: tap 165,432 · assign 14,946 · contract.accept 6,056 · contract.claim 5,564 · research 4,075 · pod 3,832 · minigame 3,597 · quest 1,074 · upgrade:fail 818 · upgrade 431

## ✅ No warnings
