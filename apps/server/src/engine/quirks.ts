/**
 * Worker personality quirks. Effects are applied by engine/workers.ts.
 * For multi-tick catch-up, chance-based effects use their expected value.
 */
export interface QuirkDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
}

export const QUIRKS: QuirkDef[] = [
  { id: 'procrastinator', name: 'Procrastinator', emoji: '😴', description: '10% chance to nap each tick, 2x output after coffee.' },
  { id: 'overachiever', name: 'Overachiever', emoji: '🏃', description: '+20% output, but burns energy twice as fast.' },
  { id: 'night-owl', name: 'Night Owl', emoji: '🦉', description: '+40% output 20:00-06:00 server time, -15% otherwise.' },
  { id: 'early-bird', name: 'Early Bird', emoji: '🐦', description: '+40% output 05:00-11:00 server time, -15% otherwise.' },
  { id: 'lucky', name: 'Lucky Charm', emoji: '🍀', description: '3% chance each tick to produce 5x.' },
  { id: 'chatterbox', name: 'Chatterbox', emoji: '🗣️', description: '-10% own output, +5% to everyone else at the same workplace.' },
  { id: 'perfectionist', name: 'Perfectionist', emoji: '🧐', description: '+10 product quality, -10% speed.' },
  { id: 'coffee-addict', name: 'Coffee Addict', emoji: '☕', description: '0.6x output without coffee, 1.7x with coffee.' },
  { id: 'zen', name: 'Zen Master', emoji: '🧘', description: 'Mood never drops below 60.' },
  { id: 'drama-llama', name: 'Drama Llama', emoji: '🦙', description: '+15% when mood is above 80, -15% below 40. Starts gossip.' },
  { id: 'speedrunner', name: 'Speedrunner', emoji: '⏱️', description: '+30% production speed, -8 quality.' },
  { id: 'cursed', name: 'Cursed', emoji: '🧿', description: '15% chance of zero output, 2% chance of 10x.' },
  { id: 'napper', name: 'Power Napper', emoji: '🛌', description: 'Naps 20% of the time but recovers energy 3x faster.' },
  { id: 'hype-beast', name: 'Hype Beast', emoji: '🔥', description: '+25% output while a marketing campaign runs.' },
  { id: 'penny-pincher', name: 'Penny Pincher', emoji: '🪙', description: 'Asks for 40% lower wages.' },
  { id: 'gym-bro', name: 'Gym Bro', emoji: '💪', description: 'Energy drains half as fast.' },
  { id: 'meme-lord', name: 'Meme Lord', emoji: '🐸', description: '+5% shop traffic per Meme Lord (max 3).' },
  { id: 'steady-eddie', name: 'Steady Eddie', emoji: '🧱', description: 'Reliable. +8% output, no surprises.' },
];

export const QUIRK_IDS = QUIRKS.map((q) => q.id);
export const quirkById = new Map(QUIRKS.map((q) => [q.id, q]));

/** One-liners for speech bubbles, keyed by mood band. */
export const WORKER_LINES = {
  happy: ['Best. Job. Ever.', 'I love these spreadsheets!', 'Synergy unlocked!', 'Is it Friday? Feels like Friday.', 'I just optimised the stapler.'],
  ok: ['Working hard or hardly working?', 'Just one more coffee.', 'Did someone say snacks?', 'Typing... typing...', 'I am being productive, I swear.'],
  sad: ['Is this a meeting that could be an email?', 'I need a nap.', 'My keyboard is judging me.', 'Who moved my chair?', 'Send coffee. Lots.'],
  tired: ['Zzz...', 'Five more minutes...', 'Running on fumes!', 'My battery is at 2%.'],
};
