/** Later phases (exchange, properties...) add seed steps here. */
const hooks: Array<{ name: string; fn: (say: (s: string) => void) => void }> = [];
export function registerSeedHook(name: string, fn: (say: (s: string) => void) => void) {
  hooks.push({ name, fn });
}
export function runSeedHooks(say: (s: string) => void) {
  for (const h of hooks) h.fn(say);
}
