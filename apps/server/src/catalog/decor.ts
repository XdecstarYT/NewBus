/** Shop items: decorations, pets, cosmetics. Perks are small on purpose (no pay-to-win; Bits only). */
export interface ShopItem {
  key: string;
  kind: 'decor' | 'pet' | 'cosmetic' | 'equipment';
  name: string;
  emoji: string;
  description: string;
  cost: number;
  minLevel: number;
  set?: string;
  perk: { mood?: number; income?: number; traffic?: number; research?: number; quality?: number; speed?: number };
}

export const SHOP_ITEMS: ShopItem[] = [
  // decorations
  { key: 'office-plant', kind: 'decor', name: 'Office Plant', emoji: '🪴', description: 'Photosynthesises good vibes.', cost: 300, minLevel: 1, set: 'jungle', perk: { mood: 3 } },
  { key: 'rubber-duck', kind: 'decor', name: 'Rubber Duck', emoji: '🦆', description: 'Listens to every bug report.', cost: 400, minLevel: 1, set: 'debug', perk: { income: 0.01 } },
  { key: 'lava-lamp', kind: 'decor', name: 'Lava Lamp', emoji: '🫧', description: 'Hypnotically groovy.', cost: 600, minLevel: 2, set: 'retro', perk: { mood: 4 } },
  { key: 'motivational-poster', kind: 'decor', name: 'Motivational Poster', emoji: '🖼️', description: 'HANG IN THERE (cat included).', cost: 500, minLevel: 1, perk: { mood: 2, income: 0.01 } },
  { key: 'bean-bag', kind: 'decor', name: 'Bean Bag Chair', emoji: '🛋️', description: 'Nobody gets up. Ever.', cost: 900, minLevel: 2, set: 'chill', perk: { mood: 6 } },
  { key: 'disco-ball', kind: 'decor', name: 'Disco Ball', emoji: '🪩', description: 'Every Friday is a party.', cost: 2500, minLevel: 4, set: 'retro', perk: { mood: 5, traffic: 0.03 } },
  { key: 'arcade-cabinet', kind: 'decor', name: 'Arcade Cabinet', emoji: '🕹️', description: 'Break-time high scores.', cost: 4000, minLevel: 5, set: 'retro', perk: { mood: 7 } },
  { key: 'whiteboard', kind: 'decor', name: 'Giant Whiteboard', emoji: '⬜', description: 'Covered in arrows nobody understands.', cost: 1200, minLevel: 2, set: 'debug', perk: { research: 0.05 } },
  { key: 'neon-sign', kind: 'decor', name: 'Neon Sign', emoji: '💡', description: 'Says "GOOD VIBES ONLY". Flickers.', cost: 1800, minLevel: 3, set: 'retro', perk: { traffic: 0.04 } },
  { key: 'aquarium-tank', kind: 'decor', name: 'Fish Tank', emoji: '🐠', description: 'The fish judge silently.', cost: 2200, minLevel: 3, set: 'jungle', perk: { mood: 5 } },
  { key: 'hammock', kind: 'decor', name: 'Nap Hammock', emoji: '🏝️', description: 'Officially "a strategy space".', cost: 1500, minLevel: 3, set: 'chill', perk: { mood: 4 } },
  { key: 'trophy-shelf', kind: 'decor', name: 'Trophy Shelf', emoji: '🏆', description: 'Mostly participation trophies.', cost: 3000, minLevel: 5, perk: { traffic: 0.03, mood: 2 } },
  { key: 'espresso-bar', kind: 'decor', name: 'Espresso Bar', emoji: '☕', description: 'Fuel for heroes.', cost: 5000, minLevel: 6, set: 'chill', perk: { income: 0.03 } },
  { key: 'ball-pit', kind: 'decor', name: 'Ball Pit', emoji: '🔴', description: 'For meetings. Obviously.', cost: 6000, minLevel: 7, set: 'chill', perk: { mood: 9 } },
  { key: 'zen-garden', kind: 'decor', name: 'Zen Garden', emoji: '🪨', description: 'Rake. Breathe. Profit.', cost: 3500, minLevel: 5, set: 'jungle', perk: { mood: 6, quality: 2 } },
  { key: 'golden-stapler', kind: 'decor', name: 'Golden Stapler', emoji: '📎', description: 'Pure prestige.', cost: 15000, minLevel: 10, set: 'debug', perk: { income: 0.04 } },
  // pets
  { key: 'keyboard-cat', kind: 'pet', name: 'Cat on Keyboard', emoji: '🐈', description: 'Types random words. Some are genius.', cost: 1500, minLevel: 2, perk: { mood: 5, research: 0.05 } },
  { key: 'office-dog', kind: 'pet', name: 'Office Dog', emoji: '🐕', description: 'Head of Morale.', cost: 2000, minLevel: 3, perk: { mood: 8 } },
  { key: 'tiny-dragon', kind: 'pet', name: 'Tiny Dragon', emoji: '🐉', description: 'Keeps the coffee warm. And the stapler.', cost: 12000, minLevel: 8, perk: { income: 0.05, mood: 3 } },
  { key: 'goldfish', kind: 'pet', name: 'Goldfish', emoji: '🐟', description: '3-second memory, 5-star attitude.', cost: 600, minLevel: 1, perk: { mood: 2 } },
  { key: 'parrot', kind: 'pet', name: 'Sales Parrot', emoji: '🦜', description: 'Repeats your slogan to customers.', cost: 3000, minLevel: 4, perk: { traffic: 0.06 } },
  { key: 'hamster', kind: 'pet', name: 'Hamster Intern', emoji: '🐹', description: 'Runs the backup generator.', cost: 900, minLevel: 2, perk: { speed: 0.03 } },
  { key: 'owl', kind: 'pet', name: 'Night Owl', emoji: '🦉', description: 'Very wise. Very awake.', cost: 4500, minLevel: 5, perk: { research: 0.1 } },
  { key: 'unicorn', kind: 'pet', name: 'Startup Unicorn', emoji: '🦄', description: 'Valued at a billion Bits. Eats glitter.', cost: 25000, minLevel: 12, perk: { income: 0.06, traffic: 0.05 } },
  // cosmetics (no perks)
  { key: 'wallpaper-stars', kind: 'cosmetic', name: 'Starry Wallpaper', emoji: '🌌', description: 'Space vibes. Purely cosmetic.', cost: 800, minLevel: 1, perk: {} },
  { key: 'wallpaper-candy', kind: 'cosmetic', name: 'Candy Stripes', emoji: '🍬', description: 'Sweet stripes. Unlocks the Candy theme.', cost: 1200, minLevel: 2, perk: {} },
  { key: 'wallpaper-ocean', kind: 'cosmetic', name: 'Ocean Waves', emoji: '🌊', description: 'Unlocks the Ocean theme.', cost: 1200, minLevel: 3, perk: {} },
  { key: 'wallpaper-retro', kind: 'cosmetic', name: 'Retro Arcade', emoji: '👾', description: 'Unlocks the Retro theme.', cost: 1500, minLevel: 4, perk: {} },
  { key: 'wallpaper-forest', kind: 'cosmetic', name: 'Forest Floor', emoji: '🌲', description: 'Unlocks the Forest theme.', cost: 1500, minLevel: 4, perk: {} },
  { key: 'desk-gold', kind: 'cosmetic', name: 'Golden Desk Skin', emoji: '🟨', description: 'Shiny desks. No perks, all swagger.', cost: 5000, minLevel: 6, perk: {} },
];

export const SETS: Record<string, { name: string; emoji: string; bonus: { income?: number; mood?: number; traffic?: number } }> = {
  jungle: { name: 'Office Jungle', emoji: '🌿', bonus: { mood: 5 } },
  retro: { name: 'Retro Lounge', emoji: '📼', bonus: { traffic: 0.05 } },
  chill: { name: 'Chill Zone', emoji: '😎', bonus: { mood: 6 } },
  debug: { name: 'Debug Den', emoji: '🐛', bonus: { income: 0.03 } },
};

export const ITEM_MAP = new Map(SHOP_ITEMS.map((i) => [i.key, i]));
