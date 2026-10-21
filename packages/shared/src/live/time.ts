/**
 * Game time runs 12× faster than real time: 1 real hour = 12 game hours, so a
 * game day passes every 2 real hours. Deadlines, elections, court dates, quests
 * and union dues all follow game time. Typing out an office job and Energy
 * refilling still happen in real time.
 */
export const GAME_SPEED = 12;
/** Real milliseconds in one game minute / hour / day. */
export const GAME_MINUTE = 60_000 / GAME_SPEED;
export const GAME_HOUR = 3_600_000 / GAME_SPEED;
export const GAME_DAY = 86_400_000 / GAME_SPEED;
/** Day 1 of the game calendar started here (real time). */
export const GAME_EPOCH = Date.UTC(2026, 0, 1);

/** Game-calendar time for a real timestamp. */
export const gameTime = (realMs: number) => GAME_EPOCH + (realMs - GAME_EPOCH) * GAME_SPEED;
/** Game day number (1, 2, 3...) for a real timestamp. */
export const gameDay = (realMs: number) => Math.floor((realMs - GAME_EPOCH) / GAME_DAY) + 1;
/** A key that changes once per game day (quests, union dues, AI client jobs). */
export const gameDayKey = (realMs: number) => `g${gameDay(realMs)}`;

/** "Day 42 · 09:30" */
export function formatGameClock(realMs: number) {
  const t = new Date(gameTime(realMs));
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(Math.floor(t.getUTCMinutes() / 10) * 10).padStart(2, '0');
  return `Day ${gameDay(realMs)} · ${hh}:${mm}`;
}

/** A real duration in game words: "3 game hours", "2 game days". */
export function formatGameDuration(realMs: number) {
  const h = Math.max(0, realMs) / GAME_HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} game min`;
  if (h < 48) return `${Math.round(h)} game hour${Math.round(h) === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} game days`;
}
