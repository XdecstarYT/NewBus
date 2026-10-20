/** Overridable clock so tests can move time. */
let offset = 0;
export const clock = {
  now: () => Date.now() + offset,
  advance: (ms: number) => {
    offset += ms;
  },
  reset: () => {
    offset = 0;
  },
};
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const dayKey = (ms = clock.now()) => new Date(ms).toISOString().slice(0, 10);
