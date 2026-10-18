import crypto from 'node:crypto';

/** Short, URL-safe, sortable-ish ids: <prefix>_<time36><random>. */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(6).toString('base64url')}`;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Friendly temporary passwords like "Wobbly-Toaster-42". */
const ADJ = ['Wobbly', 'Sparkly', 'Grumpy', 'Turbo', 'Fuzzy', 'Sneaky', 'Jolly', 'Bouncy', 'Cosmic', 'Spicy', 'Snazzy', 'Zippy', 'Cheeky', 'Mighty', 'Groovy'];
const NOUN = ['Toaster', 'Pickle', 'Robot', 'Waffle', 'Llama', 'Stapler', 'Muffin', 'Pixel', 'Noodle', 'Badger', 'Cactus', 'Donut', 'Walrus', 'Gadget', 'Penguin'];
export function friendlyPassword(): string {
  const r = (n: number) => crypto.randomInt(n);
  return `${ADJ[r(ADJ.length)]}-${NOUN[r(NOUN.length)]}-${10 + r(90)}`;
}
