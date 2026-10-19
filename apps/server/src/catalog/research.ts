/**
 * Research tree: 5 branches x 6 nodes. Each node has a few levels; effects stack
 * per level. Costs are in Research Points (RP) earned by THINKER workers over time.
 * Effects plug into the multipliers registry (see services/research.ts).
 */
export type ResearchEffect = 'income' | 'traffic' | 'speed' | 'quality' | 'mood' | 'research' | 'wages' | 'minigame' | 'offline' | 'pity';

export interface ResearchNode {
  key: string;
  branch: string;
  name: string;
  emoji: string;
  description: string;
  effect: ResearchEffect;
  /** per level: multiplicative effects use a fraction (+0.05 = +5%), additive ones a flat value */
  perLevel: number;
  maxLevel: number;
  baseCost: number;
  requires?: string;
}

export interface ResearchBranch {
  id: string;
  name: string;
  emoji: string;
  color: string;
  blurb: string;
}

export const BRANCHES: ResearchBranch[] = [
  { id: 'money', name: 'Money Magic', emoji: '💰', color: '#16a34a', blurb: 'Make more Bits from everything.' },
  { id: 'people', name: 'People Power', emoji: '🧑‍🤝‍🧑', color: '#db2777', blurb: 'Happier, cheaper, stronger workers.' },
  { id: 'factory', name: 'Factory Floor', emoji: '🏭', color: '#ea580c', blurb: 'Faster production, better quality.' },
  { id: 'hype', name: 'Hype Machine', emoji: '📣', color: '#7c3aed', blurb: 'More customers through the door.' },
  { id: 'brains', name: 'Big Brains', emoji: '🧠', color: '#0284c7', blurb: 'Research faster and unlock weird perks.' },
];

export const RESEARCH: ResearchNode[] = [
  // Money Magic
  { key: 'piggy-bank-ai', branch: 'money', name: 'Piggy Bank AI', emoji: '🐷', description: 'A piggy bank that counts itself.', effect: 'income', perLevel: 0.03, maxLevel: 5, baseCost: 20 },
  { key: 'compound-snacks', branch: 'money', name: 'Compound Snacks', emoji: '🍪', description: 'Snacks that pay interest in morale.', effect: 'mood', perLevel: 2, maxLevel: 3, baseCost: 35, requires: 'piggy-bank-ai' },
  { key: 'coin-polisher', branch: 'money', name: 'Coin Polisher 9000', emoji: '✨', description: 'Shinier Bits are worth more. Probably.', effect: 'income', perLevel: 0.04, maxLevel: 5, baseCost: 60, requires: 'piggy-bank-ai' },
  { key: 'tax-wizardry', branch: 'money', name: 'Totally Legal Tax Wizardry', emoji: '🧙', description: 'Wages feel lighter somehow.', effect: 'wages', perLevel: 0.03, maxLevel: 4, baseCost: 90, requires: 'coin-polisher' },
  { key: 'arcade-sponsor', branch: 'money', name: 'Arcade Sponsorship', emoji: '🕹️', description: 'Mini-games pay a little better.', effect: 'minigame', perLevel: 0.05, maxLevel: 4, baseCost: 80, requires: 'coin-polisher' },
  { key: 'golden-goose', branch: 'money', name: 'Golden Goose (Digital)', emoji: '🪿', description: 'Lays one golden byte per tick.', effect: 'income', perLevel: 0.06, maxLevel: 3, baseCost: 200, requires: 'tax-wizardry' },
  // People Power
  { key: 'bean-bags', branch: 'people', name: 'Bean Bag Research', emoji: '🛋️', description: 'Science says comfy = productive.', effect: 'mood', perLevel: 2, maxLevel: 5, baseCost: 20 },
  { key: 'pizza-fridays', branch: 'people', name: 'Pizza Fridays (Every Day)', emoji: '🍕', description: 'Calendar reform for pizza reasons.', effect: 'mood', perLevel: 3, maxLevel: 3, baseCost: 45, requires: 'bean-bags' },
  { key: 'union-of-bots', branch: 'people', name: 'Friendly Bot Union', emoji: '🤝', description: 'Fair deals mean lower wage bills.', effect: 'wages', perLevel: 0.04, maxLevel: 4, baseCost: 70, requires: 'bean-bags' },
  { key: 'nap-pods', branch: 'people', name: 'Nap Pods', emoji: '😴', description: 'Workers keep earning a bit longer while you are away.', effect: 'offline', perLevel: 1, maxLevel: 4, baseCost: 110, requires: 'pizza-fridays' },
  { key: 'talent-scout', branch: 'people', name: 'Talent Scout Drone', emoji: '🛸', description: 'Epic workers show up sooner (lower pity timer).', effect: 'pity', perLevel: 1, maxLevel: 3, baseCost: 150, requires: 'union-of-bots' },
  { key: 'team-spirit', branch: 'people', name: 'Team Spirit Engine', emoji: '📯', description: 'Everybody just works better together.', effect: 'income', perLevel: 0.05, maxLevel: 3, baseCost: 220, requires: 'nap-pods' },
  // Factory Floor
  { key: 'oiled-gears', branch: 'factory', name: 'Extra-Oiled Gears', emoji: '⚙️', description: 'Squeak-free production.', effect: 'speed', perLevel: 0.05, maxLevel: 5, baseCost: 20 },
  { key: 'quality-goggles', branch: 'factory', name: 'Quality Goggles', emoji: '🥽', description: 'See defects before they happen.', effect: 'quality', perLevel: 2, maxLevel: 5, baseCost: 40, requires: 'oiled-gears' },
  { key: 'conveyor-disco', branch: 'factory', name: 'Conveyor Belt Disco', emoji: '🪩', description: 'Products move faster to the beat.', effect: 'speed', perLevel: 0.06, maxLevel: 4, baseCost: 75, requires: 'oiled-gears' },
  { key: 'robot-chefs', branch: 'factory', name: 'Robot Sous-Chefs', emoji: '🤖', description: 'Tiny robots that double-check everything.', effect: 'quality', perLevel: 3, maxLevel: 3, baseCost: 120, requires: 'quality-goggles' },
  { key: 'time-crystals', branch: 'factory', name: 'Pocket Time Crystals', emoji: '💎', description: 'Bend time just a little for faster batches.', effect: 'speed', perLevel: 0.08, maxLevel: 3, baseCost: 210, requires: 'conveyor-disco' },
  { key: 'zero-waste', branch: 'factory', name: 'Zero-Waste Wizardry', emoji: '♻️', description: 'Leftovers become profit.', effect: 'income', perLevel: 0.04, maxLevel: 3, baseCost: 180, requires: 'robot-chefs' },
  // Hype Machine
  { key: 'catchy-jingle', branch: 'hype', name: 'Catchy Jingle', emoji: '🎶', description: 'Customers hum it for days.', effect: 'traffic', perLevel: 0.04, maxLevel: 5, baseCost: 20 },
  { key: 'mascot-suit', branch: 'hype', name: 'Giant Mascot Suit', emoji: '🦄', description: 'Somebody has to wear it.', effect: 'traffic', perLevel: 0.05, maxLevel: 4, baseCost: 50, requires: 'catchy-jingle' },
  { key: 'viral-dance', branch: 'hype', name: 'Viral Office Dance', emoji: '💃', description: '10 million views and counting.', effect: 'traffic', perLevel: 0.06, maxLevel: 3, baseCost: 90, requires: 'catchy-jingle' },
  { key: 'free-samples', branch: 'hype', name: 'Suspiciously Free Samples', emoji: '🧁', description: 'Customers get hooked. Legally.', effect: 'income', perLevel: 0.03, maxLevel: 4, baseCost: 110, requires: 'mascot-suit' },
  { key: 'blimp', branch: 'hype', name: 'Advertising Blimp', emoji: '🎈', description: 'Visible from three districts away.', effect: 'traffic', perLevel: 0.08, maxLevel: 3, baseCost: 190, requires: 'viral-dance' },
  { key: 'fan-club', branch: 'hype', name: 'Official Fan Club', emoji: '📣', description: 'They have matching hats.', effect: 'mood', perLevel: 3, maxLevel: 3, baseCost: 160, requires: 'free-samples' },
  // Big Brains
  { key: 'more-whiteboards', branch: 'brains', name: 'More Whiteboards', emoji: '⬜', description: 'More arrows, more ideas.', effect: 'research', perLevel: 0.1, maxLevel: 5, baseCost: 15 },
  { key: 'thinking-caps', branch: 'brains', name: 'Literal Thinking Caps', emoji: '🎓', description: 'They have little propellers.', effect: 'research', perLevel: 0.12, maxLevel: 4, baseCost: 40, requires: 'more-whiteboards' },
  { key: 'game-theory', branch: 'brains', name: 'Game Theory (Actual Games)', emoji: '🎮', description: 'Mini-game skills transfer to the job. Allegedly.', effect: 'minigame', perLevel: 0.06, maxLevel: 4, baseCost: 70, requires: 'more-whiteboards' },
  { key: 'lucky-algorithms', branch: 'brains', name: 'Lucky Algorithms', emoji: '🍀', description: 'Rare workers find you faster.', effect: 'pity', perLevel: 1, maxLevel: 3, baseCost: 140, requires: 'thinking-caps' },
  { key: 'dream-journal', branch: 'brains', name: 'Office Dream Journal', emoji: '📓', description: 'Ideas arrive even while you sleep.', effect: 'offline', perLevel: 1, maxLevel: 3, baseCost: 150, requires: 'thinking-caps' },
  { key: 'galaxy-brain', branch: 'brains', name: 'Galaxy Brain Mode', emoji: '🌌', description: 'Everything is a little better. Nobody knows why.', effect: 'income', perLevel: 0.05, maxLevel: 3, baseCost: 260, requires: 'lucky-algorithms' },
];

export const RESEARCH_MAP = new Map(RESEARCH.map((n) => [n.key, n]));

/** RP cost of buying the next level (0-based current level). */
export function researchCost(node: ResearchNode, currentLevel: number) {
  return Math.round(node.baseCost * Math.pow(1.6, currentLevel));
}
