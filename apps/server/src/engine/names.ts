import type { Rng } from './rng';

const FIRST = [
  'Bleep', 'Bloop', 'Captain', 'Doctor', 'Sir', 'Lady', 'Professor', 'Tiny', 'Big', 'Fuzzy', 'Sparky', 'Wobbly', 'Turbo', 'Pixel', 'Noodle', 'Gizmo', 'Mochi',
  'Waffles', 'Biscuit', 'Pickles', 'Nugget', 'Zippy', 'Bubbles', 'Cosmo', 'Ziggy', 'Dottie', 'Bean', 'Toast', 'Sprout', 'Chip', 'Dash', 'Kiwi', 'Muffin', 'Socks',
  'Tofu', 'Bonbon', 'Pebble', 'Clippy-ish', 'Gadget', 'Rusty', 'Sunny', 'Glitch', 'Widget', 'Comet', 'Jelly', 'Pudding', 'Taco', 'Boba', 'Dumpling', 'Sprocket',
];
const LAST = [
  'McByte', 'Von Clicky', 'Spreadsheet', 'Overclock', 'Fizzbang', 'Snuggles', 'Quackers', 'Thunderpants', 'Wigglesworth', 'Bitsworth', 'Dataface', 'Cogsley',
  'Pancake', 'Megabyte', 'Loopington', 'Wobblebottom', 'Jinglefoot', 'Beepboop', 'Moonbeam', 'Stapleton', 'Keyboardia', 'Debugger', 'Snoozalot', 'Fluffington',
  'Kerfuffle', 'Hullabaloo', 'Zapper', 'Doodlebug', 'Featherbyte', 'Gearhart', 'Puddleworth', 'Sprinkleton', 'Bananaphone', 'Lagsalot', 'Quibble',
];
const COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#a3e635', '#fbbf24', '#94a3b8'];

export function workerName(rng: Rng): string {
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}

export function workerAppearance(rng: Rng) {
  return { color: rng.pick(COLORS), eyes: rng.int(0, 5), accessory: rng.int(0, 9) };
}

const NPC_FIRST = ['Agnes', 'Barry', 'Chloe', 'Dmitri', 'Esme', 'Fergus', 'Gwen', 'Hugo', 'Ines', 'Jasper', 'Kiki', 'Leo', 'Mabel', 'Nico', 'Olga', 'Percy', 'Quinn', 'Rosa', 'Stan', 'Tilly', 'Uma', 'Vic', 'Wanda', 'Xavi', 'Yara', 'Zed'];
export function npcName(rng: Rng): string {
  return `${rng.pick(NPC_FIRST)} ${String.fromCharCode(65 + rng.int(0, 25))}.`;
}
