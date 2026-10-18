/**
 * Idle / offline earnings window. A company accrues income from its last tick
 * up to "now", but never past (lastActiveAt + offlineCap) and never more than
 * maxCatchup in a single tick (e.g. after server downtime).
 */
export function accrualMs(o: { lastTickAt: number; lastActiveAt: number; now: number; offlineCapMs: number; maxCatchupMs: number }): number {
  const cutoff = Math.min(o.now, o.lastActiveAt + o.offlineCapMs);
  const from = Math.max(o.lastTickAt, o.now - o.maxCatchupMs);
  return Math.max(0, cutoff - from);
}
