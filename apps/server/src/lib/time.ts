/** Overridable clock so tests and simulations can control time. */
let offset = 0;
let fixed: number | null = null;
export const clock = {
  now: () => (fixed ?? Date.now()) + offset,
  advance: (ms: number) => {
    offset += ms;
  },
  set: (ms: number | null) => {
    fixed = ms;
    offset = 0;
  },
};

export const DAY_MS = 24 * 3600_000;
export const HOUR_MS = 3600_000;
export const MINUTE_MS = 60_000;

/** UTC day key "2026-10-18" used for daily caps. */
export function dayKey(ms = clock.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function startOfDay(ms = clock.now()): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
