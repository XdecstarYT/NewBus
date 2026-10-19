/**
 * Achievements: tiered stat milestones (hundreds of them) plus a few special
 * ones. Every achievement also unlocks a silly title players can wear.
 */
export interface AchievementDef {
  key: string;
  name: string;
  emoji: string;
  description: string;
  /** what to check: a lifetime stat, company level, collection size or achievement count */
  kind: 'stat' | 'level' | 'collection' | 'meta' | 'prestige' | 'research';
  stat?: string;
  target: number;
  tier: number; // 0-based; drives the reward
  title: string;
  secret?: boolean;
}

interface Ladder {
  stat: string;
  emoji: string;
  what: string; // "Earn {n} BT"
  targets: number[];
  names: string[];
  titles: string[];
}

const TIER_WORDS = ['Rookie', 'Apprentice', 'Pro', 'Expert', 'Master', 'Legend', 'Mythic', 'Cosmic'];

const LADDERS: Ladder[] = [
  { stat: 'earned', emoji: '💰', what: 'Earn {n} BT in total', targets: [1_000, 10_000, 50_000, 250_000, 1_000_000, 5_000_000, 25_000_000, 100_000_000], names: ['First Bits', 'Pocket Money', 'Piggy Bank Full', 'Making It Rain', 'Millionaire (Bits)', 'Bit Baron', 'Byte Tycoon', 'Owns The Moon'], titles: ['Coin Counter', 'Penny Pincher', 'Money Magnet', 'Rainmaker', 'Bitillionaire', 'Baron of Bits', 'Tycoon Supreme', 'Moon Owner'] },
  { stat: 'pods', emoji: '🥚', what: 'Open {n} Recruit Pods', targets: [1, 10, 25, 50, 100, 250, 500, 1000], names: ['It Hatched!', 'Egg Collector', 'Pod Person', 'Hatchery Manager', 'Pod Professional', 'Egg-cellent', 'Pod God', 'The Great Incubator'], titles: ['Egg Opener', 'Pod Popper', 'Hatch Master', 'Egg Whisperer', 'Pod Lord', 'Omelette Avoider', 'Pod Deity', 'Incubator Prime'] },
  { stat: 'contracts', emoji: '📜', what: 'Complete {n} contracts', targets: [1, 5, 15, 40, 100, 250, 500, 1000], names: ['Signed!', 'Dealmaker', 'Contract Crusher', 'Paperwork Pro', 'Deal Machine', 'Contract Kaiju', 'Signature Legend', 'Ink Infinite'], titles: ['Pen Holder', 'Deal Starter', 'Closer', 'The Negotiator', 'Deal Machine', 'Contract Kaiju', 'Ink Legend', 'The Eternal Signature'] },
  { stat: 'taps', emoji: '👆', what: 'Tap to boost {n} times', targets: [10, 100, 500, 2_000, 10_000, 25_000, 50_000, 100_000], names: ['Tap Tap', 'Finger Workout', 'Tap Dancer', 'Speed Tapper', 'Thumb of Steel', 'Tap Tornado', 'Tapocalypse', 'The Finger of Destiny'], titles: ['Tapper', 'Clicky', 'Tap Dancer', 'Speed Finger', 'Thumb of Steel', 'Tap Tornado', 'Tapocalypse', 'Finger of Destiny'] },
  { stat: 'coffees', emoji: '☕', what: 'Buy {n} coffees for workers', targets: [1, 10, 50, 150, 400, 1000, 2500, 5000], names: ['Caffeinated', 'Coffee Run', 'Barista Buddy', 'Espresso Express', 'Bean Machine', 'Coffee Overlord', 'Human Percolator', 'The Bean Itself'], titles: ['Coffee Fetcher', 'Bean Buyer', 'Barista', 'Espresso Expert', 'Bean Machine', 'Caffeine Czar', 'Percolator', 'The Bean'] },
  { stat: 'trainings', emoji: '🏋️', what: 'Train workers {n} times', targets: [1, 10, 30, 80, 200, 500, 1000, 2500], names: ['Coach', 'Gym Buddy', 'Personal Trainer', 'Skill Builder', 'Mentor Mode', 'Sensei', 'Grand Sensei', 'Training Montage'], titles: ['Coach', 'Gym Buddy', 'Trainer', 'Skill Builder', 'Mentor', 'Sensei', 'Grand Sensei', 'Montage Hero'] },
  { stat: 'produced', emoji: '🏭', what: 'Produce {n} items', targets: [10, 100, 500, 2_000, 10_000, 50_000, 200_000, 1_000_000], names: ['Made A Thing', 'Assembly Line', 'Mass Production', 'Factory Hum', 'Industrial Revolution', 'Mega Factory', 'Output Overload', 'Infinite Widgets'], titles: ['Maker', 'Builder', 'Producer', 'Factory Boss', 'Industrialist', 'Mega Maker', 'Output Overlord', 'Widget Infinite'] },
  { stat: 'sold', emoji: '🛒', what: 'Sell {n} items to customers', targets: [10, 100, 500, 2_000, 10_000, 50_000, 200_000, 1_000_000], names: ['First Sale', 'Shopkeeper', 'Sales Star', 'Top Seller', 'Sales Machine', 'Retail Royalty', 'Checkout Champion', 'Sold The Universe'], titles: ['Shopkeeper', 'Seller', 'Sales Star', 'Top Seller', 'Sales Machine', 'Retail Royal', 'Checkout Champ', 'Universe Seller'] },
  { stat: 'revenue', emoji: '🧾', what: 'Earn {n} BT from sales', targets: [500, 5_000, 25_000, 100_000, 500_000, 2_500_000, 10_000_000, 50_000_000], names: ['Cha-Ching', 'Cash Register', 'Revenue Stream', 'Revenue River', 'Revenue Ocean', 'Revenue Galaxy', 'Revenue Universe', 'Revenue Multiverse'], titles: ['Cha-Ching', 'Cashier', 'Revenue Raker', 'River Runner', 'Ocean Owner', 'Galaxy Grosser', 'Universal Earner', 'Multiverse Merchant'] },
  { stat: 'trades', emoji: '📈', what: 'Make {n} trades on the Bit Exchange', targets: [1, 10, 50, 150, 400, 1000, 2500, 5000], names: ['First Trade', 'Day Trader', 'Market Mover', 'Ticker Tamer', 'Wall Street Wizard', 'Chart Whisperer', 'Market Maven', 'The Bell Ringer'], titles: ['Trader', 'Day Trader', 'Market Mover', 'Ticker Tamer', 'Wall St Wizard', 'Chart Whisperer', 'Market Maven', 'Bell Ringer'] },
  { stat: 'dividends', emoji: '💸', what: 'Collect {n} BT in dividends', targets: [10, 100, 1_000, 5_000, 25_000, 100_000, 500_000, 2_000_000], names: ['Passive Income', 'Dividend Dabbler', 'Coupon Clipper', 'Yield Hunter', 'Dividend King', 'Income Engine', 'Yield Galaxy', 'Money Tree'], titles: ['Shareholder', 'Dividend Dabbler', 'Coupon Clipper', 'Yield Hunter', 'Dividend King', 'Income Engine', 'Yield Lord', 'Money Tree'] },
  { stat: 'gifted', emoji: '🎁', what: 'Give away {n} BT', targets: [10, 100, 1_000, 5_000, 25_000, 100_000, 500_000, 1_000_000], names: ['Kind Soul', 'Generous', 'Philanthropist', 'Big Heart', 'Santa Mode', 'Saint of Bits', 'Benefactor', 'Heart of Gold'], titles: ['Kind Soul', 'Generous One', 'Philanthropist', 'Big Heart', 'Bit Santa', 'Saint of Bits', 'Benefactor', 'Heart of Gold'] },
  { stat: 'events', emoji: '🎲', what: 'Handle {n} office events', targets: [1, 10, 30, 80, 200, 500, 1000, 2000], names: ['Plot Twist', 'Drama Llama', 'Chaos Coordinator', 'Crisis Manager', 'Unflappable', 'Chaos Tamer', 'Event Horizon', 'Seen It All'], titles: ['Plot Twister', 'Drama Llama', 'Chaos Coordinator', 'Crisis Manager', 'Unflappable', 'Chaos Tamer', 'Event Horizon', 'Seen It All'] },
  { stat: 'upgrades', emoji: '🔧', what: 'Upgrade workplaces {n} times', targets: [1, 5, 15, 30, 60, 120, 250, 500], names: ['Fixer Upper', 'Renovator', 'Interior Designer', 'Architect', 'Master Builder', 'Skyscraper Dreams', 'City Planner', 'Megastructure'], titles: ['Fixer Upper', 'Renovator', 'Designer', 'Architect', 'Master Builder', 'Skyscraper', 'City Planner', 'Megastructure'] },
  { stat: 'spins', emoji: '🎡', what: 'Spin the Lucky Wheel {n} times', targets: [1, 7, 30, 60, 120, 250, 500, 1000], names: ['Round and Round', 'Week Streak', 'Month of Spins', 'Wheel Fan', 'Spin Doctor', 'Wheel of Fortune', 'Dizzy', 'Centrifuge'], titles: ['Spinner', 'Streaker', 'Wheel Fan', 'Spin Fan', 'Spin Doctor', 'Fortune Wheel', 'Very Dizzy', 'Human Centrifuge'] },
  { stat: 'minigames', emoji: '🕹️', what: 'Play {n} mini-games', targets: [1, 10, 50, 150, 400, 1000, 2500, 5000], names: ['Break Time', 'Arcade Regular', 'High Score Hunter', 'Joystick Jockey', 'Arcade Legend', 'Pixel Pro', 'Game Machine', 'Final Boss'], titles: ['Player One', 'Arcade Regular', 'Score Hunter', 'Joystick Jockey', 'Arcade Legend', 'Pixel Pro', 'Game Machine', 'Final Boss'] },
  { stat: 'research', emoji: '🔬', what: 'Complete {n} research levels', targets: [1, 5, 15, 30, 50, 70, 90, 110], names: ['Eureka!', 'Lab Coat', 'Mad Scientist', 'Big Brain', 'Professor', 'Genius', 'Galaxy Brain', 'Knows Everything'], titles: ['Eureka', 'Lab Coat', 'Mad Scientist', 'Big Brain', 'Professor', 'Genius', 'Galaxy Brain', 'Omniscient'] },
  { stat: 'quests', emoji: '🗺️', what: 'Complete {n} quests', targets: [1, 10, 30, 80, 200, 400, 800, 1500], names: ['Quest Accepted', 'Adventurer', 'Questing Knight', 'Quest Hero', 'Quest Legend', 'Mythic Quester', 'Epic Saga', 'Main Character'], titles: ['Adventurer', 'Quester', 'Knight', 'Quest Hero', 'Quest Legend', 'Mythic Quester', 'Saga Writer', 'Main Character'] },
  { stat: 'warsWon', emoji: '⚔️', what: 'Win {n} Business Wars', targets: [1, 3, 10, 25, 50, 100, 200, 400], names: ['Victory!', 'Champion', 'War Hero', 'Warlord (Friendly)', 'Conqueror', 'Undefeated', 'Legendary General', 'Peacekeeper (Ironically)'], titles: ['Victor', 'Champion', 'War Hero', 'Friendly Warlord', 'Conqueror', 'Undefeated', 'General', 'Ironic Peacekeeper'] },
  { stat: 'properties', emoji: '🏘️', what: 'Buy {n} properties', targets: [1, 3, 6, 10, 20, 35, 60, 100], names: ['Landlord', 'Property Ladder', 'Real Estate Mogul', 'Block Owner', 'District Boss', 'Skyline Owner', 'Map Painter', 'Owns The Map'], titles: ['Landlord', 'Climber', 'Mogul', 'Block Owner', 'District Boss', 'Skyline Owner', 'Map Painter', 'Map Owner'] },
  { stat: 'deposits', emoji: '🏦', what: 'Open {n} term deposits', targets: [1, 5, 15, 40, 100, 200, 400, 800], names: ['Saver', 'Squirrel', 'Nut Hoarder', 'Vault Keeper', 'Savings Sage', 'Compound King', 'Interest Wizard', 'Infinite Patience'], titles: ['Saver', 'Squirrel', 'Nut Hoarder', 'Vault Keeper', 'Savings Sage', 'Compound King', 'Interest Wizard', 'Patience Itself'] },
  { stat: 'packages', emoji: '📦', what: 'Open {n} real-life packages', targets: [1, 3, 10, 25, 50, 100, 200, 500], names: ['Unboxing!', 'Package Hunter', 'Mail Magnet', 'Treasure Finder', 'Box Collector', 'Delivery Legend', 'Cardboard King', 'The Postmaster'], titles: ['Unboxer', 'Package Hunter', 'Mail Magnet', 'Treasure Finder', 'Box Collector', 'Delivery Legend', 'Cardboard King', 'Postmaster'] },
  { stat: 'legendaries', emoji: '🌟', what: 'Hire {n} Legendary workers', targets: [1, 3, 6, 12, 25, 50, 100, 200], names: ['Legend Found', 'Star Collector', 'Legendary Team', 'Hall of Legends', 'Myth Maker', 'Pantheon', 'Constellation', 'The Whole Sky'], titles: ['Legend Finder', 'Star Collector', 'Team Legend', 'Hall Keeper', 'Myth Maker', 'Pantheon Boss', 'Constellation', 'Sky Owner'] },
  { stat: 'campaigns', emoji: '📣', what: 'Run {n} marketing campaigns', targets: [1, 5, 15, 40, 100, 250, 500, 1000], names: ['Hello World!', 'Hype Starter', 'Billboard Boss', 'Ad Genius', 'Viral Machine', 'Hype Lord', 'Brand Galaxy', 'Everyone Knows You'], titles: ['Announcer', 'Hype Starter', 'Billboard Boss', 'Ad Genius', 'Viral Machine', 'Hype Lord', 'Brand Galaxy', 'Household Name'] },
  { stat: 'fairs', emoji: '🎪', what: 'Exhibit at {n} trade fairs', targets: [1, 3, 8, 15, 30, 60, 120, 250], names: ['Booth Babe', 'Fair Regular', 'Expo Expert', 'Showcase Star', 'Fair Royalty', 'Expo Legend', 'Fair Forever', 'Ringmaster'], titles: ['Exhibitor', 'Fair Regular', 'Expo Expert', 'Showcase Star', 'Fair Royal', 'Expo Legend', 'Fair Forever', 'Ringmaster'] },
  { stat: 'loans', emoji: '🤝', what: 'Take {n} loans (and live to tell)', targets: [1, 3, 8, 15, 30, 60, 100, 200], names: ['Borrower', 'Credit Curious', 'Debt Dancer', 'Leverage Learner', 'Loan Ranger', 'Credit Juggler', 'Debt Wizard', 'The Bank Knows Your Name'], titles: ['Borrower', 'Credit Curious', 'Debt Dancer', 'Leverage Learner', 'Loan Ranger', 'Credit Juggler', 'Debt Wizard', 'Known By The Bank'] },
  { stat: 'promotions', emoji: '🎖️', what: 'Promote workers {n} times', targets: [1, 5, 15, 40, 100, 250, 500, 1000], names: ['Promotion!', 'Ladder Builder', 'Career Coach', 'HR Hero', 'Talent Grower', 'Star Maker', 'Career Galaxy', 'Everyone Is A Manager'], titles: ['Promoter', 'Ladder Builder', 'Career Coach', 'HR Hero', 'Talent Grower', 'Star Maker', 'Career Galaxy', 'Chief Everything'] },
  { stat: 'synergies', emoji: '✨', what: 'Trigger {n} worker synergies', targets: [1, 10, 50, 150, 400, 1000, 2500, 5000], names: ['Teamwork!', 'Dream Team', 'Synergy Seeker', 'Combo Master', 'Harmony', 'Perfect Sync', 'Hive Mind', 'One Big Brain'], titles: ['Team Player', 'Dream Teamer', 'Synergy Seeker', 'Combo Master', 'Harmony Keeper', 'Perfect Sync', 'Hive Mind', 'One Big Brain'] },
];

const LEVELS = [5, 10, 15, 20, 25, 30, 40, 50];
const LEVEL_NAMES = ['Growing Up', 'Double Digits', 'Mid-Size Marvel', 'Big Leagues', 'Quarter Century', 'Thirty and Thriving', 'Fabulous Forty', 'Half Century Hero'];

function fmt(n: number) {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${n / 1000}K` : String(n);
}

export const ACHIEVEMENTS: AchievementDef[] = [
  ...LADDERS.filter((l) => l.targets.length).flatMap((l) =>
    l.targets.map((t, i) => ({
      key: `${l.stat}-${i + 1}`,
      name: l.names[i],
      emoji: l.emoji,
      description: l.what.replace('{n}', fmt(t)),
      kind: 'stat' as const,
      stat: l.stat,
      target: t,
      tier: i,
      title: l.titles[i],
    })),
  ),
  ...LEVELS.map((lv, i) => ({ key: `level-${lv}`, name: LEVEL_NAMES[i], emoji: '⭐', description: `Reach company level ${lv}`, kind: 'level' as const, target: lv, tier: i, title: `${TIER_WORDS[i]} CEO` })),
  ...[3, 8, 15, 25, 35, 45].map((n, i) => ({ key: `collection-${n}`, name: ['Collector', 'Curator', 'Museum Owner', 'Zoo Keeper', 'Encyclopedia', 'Gotta Hire Em All'][i], emoji: '📚', description: `Collect ${n} different worker species x rarity combos`, kind: 'collection' as const, target: n, tier: i, title: ['Collector', 'Curator', 'Museum Owner', 'Zoo Keeper', 'Walking Encyclopedia', 'Completionist'][i] })),
  ...[1, 2, 3, 5, 8].map((n, i) => ({ key: `prestige-${n}`, name: ['Fresh Start', 'Second Wind', 'Hat Trick', 'Serial Founder', 'Phoenix'][i], emoji: '🚀', description: `Prestige ${n} time(s)`, kind: 'prestige' as const, target: n, tier: i + 1, title: ['Restarter', 'Second Winder', 'Hat Tricker', 'Serial Founder', 'The Phoenix'][i] })),
  ...[10, 25, 50, 100, 200].map((n, i) => ({ key: `meta-${n}`, name: ['Trophy Shelf', 'Trophy Room', 'Trophy Wing', 'Trophy Palace', 'Trophy Planet'][i], emoji: '🏆', description: `Unlock ${n} achievements`, kind: 'meta' as const, target: n, tier: i + 1, title: ['Shelf Filler', 'Room Filler', 'Wing Owner', 'Palace Owner', 'Achievement Hunter'][i] })),
  // secret, silly ones
  { key: 'secret-cursed', name: 'Cursed Office', emoji: '👻', description: 'Hire a Cursed worker (on purpose?)', kind: 'stat', stat: 'cursed', target: 1, tier: 1, title: 'Ghost Whisperer', secret: true },
  { key: 'secret-fired-10', name: 'You\'re Fired (x10)', emoji: '🔥', description: 'Fire 10 workers. Ouch.', kind: 'stat', stat: 'fired', target: 10, tier: 1, title: 'Boss From Down Under', secret: true },
  { key: 'secret-lotto', name: 'Feeling Lucky', emoji: '🎟️', description: 'Buy 25 lotto tickets', kind: 'stat', stat: 'lotto', target: 25, tier: 1, title: 'Eternal Optimist', secret: true },
  { key: 'secret-spoiled', name: 'Something Smells', emoji: '🤢', description: 'Let 50 items spoil', kind: 'stat', stat: 'spoiled', target: 50, tier: 1, title: 'Fridge Forgetter', secret: true },
  { key: 'secret-graduate', name: 'Proud Mentor', emoji: '🎓', description: 'Graduate a mentee', kind: 'stat', stat: 'graduates', target: 1, tier: 2, title: 'Wise Owl', secret: true },
];

export const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
