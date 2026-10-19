/**
 * Strategy layer catalogue, shared by server and web: 500 business actions
 * (10 categories x 10 plays x 5 tiers), company policies, market districts
 * and the laws the Owner can put to a lobbying vote.
 */

/** What an action does while it runs (multipliers are fractions: 0.05 = +5%). */
export interface StrategyFx {
  income?: number;
  traffic?: number;
  speed?: number;
  research?: number;
  wages?: number;
  /** additive points while active */
  mood?: number;
  quality?: number;
  /** one-off gains when the action starts */
  influence?: number;
  presence?: number;
  legal?: number;
  reputation?: number;
  /** adds to audit risk (0-100) */
  auditRisk?: number;
  /** share of the action's income boost hidden from the tax man (found by audits) */
  undeclared?: number;
}

export type StrategyCategory = 'marketing' | 'operations' | 'finance' | 'people' | 'rnd' | 'sales' | 'legal' | 'lobbying' | 'expansion' | 'shady';

export const STRATEGY_CATEGORIES: Record<StrategyCategory, { label: string; emoji: string; blurb: string; baseCost: number }> = {
  marketing: { label: 'Marketing', emoji: '📣', blurb: 'Get noticed. More customers walk in.', baseCost: 300 },
  operations: { label: 'Operations', emoji: '⚙️', blurb: 'Make things faster and better.', baseCost: 350 },
  finance: { label: 'Finance', emoji: '💰', blurb: 'Squeeze more Bits out of every sale.', baseCost: 400 },
  people: { label: 'People', emoji: '🧑‍🤝‍🧑', blurb: 'Happy workers, lower wage bills.', baseCost: 250 },
  rnd: { label: 'R&D', emoji: '🔬', blurb: 'Research faster, build better.', baseCost: 450 },
  sales: { label: 'Sales', emoji: '🤝', blurb: 'Close deals and grow your reputation.', baseCost: 300 },
  legal: { label: 'Legal', emoji: '⚖️', blurb: 'Lawyers up. Win court cases and survive audits.', baseCost: 500 },
  lobbying: { label: 'Lobbying', emoji: '🏛️', blurb: 'Earn influence to sway laws and union votes.', baseCost: 500 },
  expansion: { label: 'Expansion', emoji: '🗺️', blurb: 'Grab market share in your focus district.', baseCost: 400 },
  shady: { label: 'Shady Deals', emoji: '🕶️', blurb: 'Big rewards. Big audit risk. Boss Byte is watching.', baseCost: 350 },
};

interface BasePlay {
  key: string;
  name: string;
  emoji: string;
  blurb: string;
  fx: StrategyFx;
  /** minutes the effect lasts at tier 1 */
  minutes: number;
  /** chance (0-1) it backfires at tier 1 */
  risk?: number;
}

const P = (key: string, name: string, emoji: string, blurb: string, fx: StrategyFx, minutes: number, risk = 0): BasePlay => ({ key, name, emoji, blurb, fx, minutes, risk });

const PLAYS: Record<StrategyCategory, BasePlay[]> = {
  marketing: [
    P('flyers', 'Flyer Blitz', '📄', 'Paper the town with flyers.', { traffic: 0.06 }, 30),
    P('jingle', 'Catchy Jingle', '🎶', 'A tune nobody can get out of their head.', { traffic: 0.05, reputation: 2 }, 45),
    P('influencer', 'Influencer Deal', '🤳', 'Pay a cat with 2M followers to hold your product.', { traffic: 0.09 }, 30, 0.04),
    P('billboard', 'Giant Billboard', '🪧', 'Your logo, forty feet tall.', { traffic: 0.07, presence: 4 }, 60),
    P('mascot', 'Dancing Mascot', '🕺', 'Someone in a foam suit waves at traffic.', { traffic: 0.05, mood: 2 }, 40),
    P('loyalty', 'Loyalty Cards', '💳', 'Buy nine, get the tenth free.', { traffic: 0.04, income: 0.02 }, 90),
    P('viral', 'Viral Stunt', '🎥', 'It might go viral. It might go very wrong.', { traffic: 0.14 }, 25, 0.12),
    P('sponsor', 'Sponsor the Big Game', '🏟️', 'Your name on every jersey.', { traffic: 0.06, reputation: 4, influence: 2 }, 60),
    P('sample', 'Free Samples', '🍪', 'Nothing sells like free.', { traffic: 0.08, income: -0.02 }, 30),
    P('rebrand', 'Fresh Rebrand', '🎨', 'New logo, same great Bits.', { traffic: 0.05, reputation: 5 }, 120),
  ],
  operations: [
    P('lean', 'Lean Sprint', '🏃', 'Cut the waste, ship the thing.', { speed: 0.08 }, 30),
    P('overtime', 'Overtime Push', '⏰', 'Everyone stays late. Pizza provided.', { speed: 0.14, mood: -4 }, 25),
    P('qc', 'Quality Circle', '🔍', 'Workers check each other\'s work.', { quality: 4 }, 60),
    P('automate', 'Automation Pilot', '🦾', 'Robots helping robots.', { speed: 0.1, wages: -0.03 }, 60),
    P('maintenance', 'Deep Maintenance', '🧰', 'Oil every gear.', { speed: 0.05, quality: 2 }, 90),
    P('layout', 'Floor Re-layout', '🧭', 'Move the coffee machine closer.', { speed: 0.06, mood: 2 }, 60),
    P('justintime', 'Just-in-Time', '📦', 'Stock arrives exactly when needed. Usually.', { speed: 0.09, income: 0.02 }, 45, 0.05),
    P('sixsigma', 'Six Sigma Belt', '🥋', 'Fewer defects, more karate references.', { quality: 6 }, 90),
    P('nightshift', 'Night Shift', '🌙', 'The office never sleeps.', { speed: 0.12, mood: -2 }, 40),
    P('cleanup', 'Spring Cleaning', '🧹', 'Throw out the 2009 printer.', { speed: 0.04, mood: 4 }, 60),
  ],
  finance: [
    P('pricing', 'Smart Pricing', '🏷️', 'Charge what the market will bear.', { income: 0.05 }, 45),
    P('hedge', 'Hedge Fund Lunch', '🥂', 'Learn finance over tiny sandwiches.', { income: 0.04, influence: 1 }, 60),
    P('costcut', 'Cost-Cutting Review', '✂️', 'Cancel the unused gym memberships.', { wages: -0.05 }, 60),
    P('upsell', 'Upsell Training', '🍟', '"Would you like fries with that?"', { income: 0.06, reputation: -1 }, 40),
    P('bulk', 'Bulk Purchasing', '🛒', 'Buy the big box. Save the Bits.', { income: 0.03, wages: -0.02 }, 90),
    P('treasury', 'Treasury Sweep', '🧹', 'Find Bits under the sofa cushions.', { income: 0.04 }, 60),
    P('audit-prep', 'Clean Books', '📚', 'Tidy accounts make auditors smile.', { auditRisk: -6, legal: 1 }, 60),
    P('invest', 'Reinvest Profits', '🔁', 'Put the money back to work.', { income: 0.03, speed: 0.03 }, 90),
    P('dynamic', 'Dynamic Pricing', '📈', 'Prices change every minute. Customers notice.', { income: 0.09, traffic: -0.03 }, 30, 0.04),
    P('premium', 'Premium Line', '💎', 'Gold-plated version, triple the price.', { income: 0.07, quality: 2 }, 60),
  ],
  people: [
    P('pizza', 'Pizza Party', '🍕', 'Nothing says thank you like cheese.', { mood: 6 }, 30),
    P('training', 'Skills Workshop', '🎓', 'Everyone learns a new trick.', { speed: 0.04, quality: 2 }, 60),
    P('bonus', 'Surprise Bonus', '🎁', 'Small envelope, big smiles.', { mood: 8, wages: 0.03 }, 45),
    P('remote', 'Remote Fridays', '🏠', 'Work in pyjamas once a week.', { mood: 5, speed: -0.02 }, 120),
    P('mentoring', 'Mentoring Program', '🧑‍🏫', 'Veterans teach the rookies.', { quality: 3, mood: 2 }, 90),
    P('wellness', 'Wellness Week', '🧘', 'Yoga at 10, naps at 3.', { mood: 7 }, 60),
    P('contractor', 'Hire Contractors', '🧾', 'Cheaper, but they eat your snacks.', { wages: -0.06, mood: -3 }, 60),
    P('teambuild', 'Team Building Trip', '🧗', 'Trust falls. Mostly caught.', { mood: 5, speed: 0.03 }, 60, 0.03),
    P('fourday', 'Four-Day Week', '📅', 'Happier and somehow just as fast.', { mood: 6, wages: 0.02 }, 120),
    P('recognition', 'Employee of the Month', '🏅', 'A framed photo works wonders.', { mood: 4, quality: 1 }, 90),
  ],
  rnd: [
    P('hackathon', 'Hackathon', '💻', '48 hours, 400 energy drinks.', { research: 0.15, mood: -2 }, 30),
    P('lab', 'Lab Upgrade', '🧪', 'Shinier beakers.', { research: 0.1 }, 90),
    P('patent', 'Patent Filing', '📜', 'Protect your ideas, impress the judge.', { research: 0.05, legal: 2 }, 60),
    P('prototype', 'Rapid Prototyping', '🛠️', 'Fail fast, learn faster.', { research: 0.08, quality: 2 }, 45),
    P('university', 'University Partnership', '🏫', 'Interns with big ideas.', { research: 0.12, influence: 1 }, 120),
    P('moonshot', 'Moonshot Project', '🚀', 'Probably won\'t work. If it does...', { research: 0.25 }, 30, 0.1),
    P('reverse', 'Teardown Study', '🔩', 'Take the competition\'s product apart.', { research: 0.1, quality: 1 }, 60, 0.03),
    P('ai', 'AI Assistant', '🤖', 'A robot to help the robots research.', { research: 0.12, speed: 0.03 }, 60),
    P('focus', 'Focus Group', '🗣️', 'Ask real customers what they think.', { quality: 3, traffic: 0.02 }, 60),
    P('opensrc', 'Open Source It', '🌐', 'Share your code, earn the love.', { research: 0.06, reputation: 3 }, 90),
  ],
  sales: [
    P('cold', 'Cold Calling', '☎️', '"Is this a good time?" It never is.', { traffic: 0.05, income: 0.02 }, 30),
    P('trade', 'Trade Show Booth', '🎪', 'Free pens for everyone.', { traffic: 0.06, reputation: 2 }, 60),
    P('keyacct', 'Key Account Dinner', '🍝', 'Wine and dine your best customers.', { income: 0.05, influence: 1 }, 60),
    P('bundle', 'Bundle Deal', '🎁', 'Two products, one price.', { traffic: 0.07, income: -0.01 }, 45),
    P('referral', 'Referral Bonus', '🔗', 'Bring a friend, get a discount.', { traffic: 0.06 }, 60),
    P('survey', 'Happy-Customer Survey', '📝', 'Ask for five stars. Politely.', { reputation: 4 }, 30),
    P('flash', 'Flash Sale', '⚡', 'Everything 20% off for one hour.', { traffic: 0.12, income: -0.03 }, 20),
    P('export', 'Export Push', '🚢', 'Sell to the next town over.', { income: 0.05, presence: 3 }, 90),
    P('partner', 'Channel Partners', '🤝', 'Other shops sell your stuff too.', { traffic: 0.04, income: 0.03 }, 120),
    P('guarantee', 'Money-Back Guarantee', '🛡️', 'Confidence sells.', { traffic: 0.05, reputation: 3 }, 90, 0.03),
  ],
  legal: [
    P('counsel', 'Retain Counsel', '👔', 'A lawyer on speed dial.', { legal: 5 }, 60),
    P('compliance', 'Compliance Review', '✅', 'Check every rule twice.', { legal: 3, auditRisk: -8 }, 60),
    P('contracts', 'Contract Templates', '🖋️', 'Watertight paperwork.', { legal: 4 }, 90),
    P('trademark', 'Trademark Everything', '™️', 'Even the coffee mug.', { legal: 3, reputation: 1 }, 90),
    P('lawfirm', 'Big Law Firm', '🏢', 'Partners who bill by the minute.', { legal: 9 }, 120),
    P('mediation', 'Mediation Training', '🕊️', 'Settle before it gets ugly.', { legal: 4, mood: 1 }, 60),
    P('insurance', 'Liability Insurance', '☂️', 'Sleep better at night.', { legal: 4, auditRisk: -3 }, 120),
    P('whistle', 'Ethics Hotline', '📞', 'Catch problems early.', { auditRisk: -10, reputation: 2 }, 90),
    P('expert', 'Expert Witnesses', '🧑‍⚖️', 'People with very long titles.', { legal: 6 }, 60),
    P('precedent', 'Precedent Research', '📖', 'Find the case that wins yours.', { legal: 5, research: 0.02 }, 60),
  ],
  lobbying: [
    P('petition', 'Start a Petition', '📋', 'Signatures mean influence.', { influence: 3 }, 30),
    P('gala', 'Charity Gala', '🎩', 'Tuxedos and good causes.', { influence: 4, reputation: 3 }, 60),
    P('thinktank', 'Fund a Think Tank', '🧠', 'Smart people writing reports about you.', { influence: 6 }, 90),
    P('townhall', 'Town Hall Meeting', '🏛️', 'Shake hands, kiss babies.', { influence: 3, presence: 2 }, 60),
    P('media', 'Op-Ed Campaign', '📰', 'Write to the Daily Byte.', { influence: 4, traffic: 0.02 }, 60),
    P('pac', 'Industry Coalition', '🤝', 'Strength in numbers.', { influence: 7 }, 120),
    P('grassroots', 'Grassroots Drive', '🌱', 'Knock on every door.', { influence: 4, mood: 1 }, 60),
    P('backroom', 'Backroom Deal', '🚪', 'Cigars and quiet promises.', { influence: 10, auditRisk: 5 }, 60, 0.08),
    P('summit', 'Business Summit', '🎤', 'Keynote speaker: you.', { influence: 5, reputation: 2 }, 90),
    P('donation', 'Community Donation', '🎗️', 'Give back, gain goodwill.', { influence: 3, reputation: 4 }, 60),
  ],
  expansion: [
    P('popup', 'Pop-Up Store', '⛺', 'Here today, gone tomorrow.', { presence: 5, traffic: 0.03 }, 45),
    P('branch', 'New Branch', '🏬', 'Plant your flag in the district.', { presence: 9 }, 120),
    P('franchise', 'Franchise Deal', '🍔', 'Others run your shop for you.', { presence: 7, income: 0.02 }, 120),
    P('delivery', 'Delivery Fleet', '🛵', 'Reach every doorstep.', { presence: 6, traffic: 0.03 }, 90),
    P('kiosk', 'Kiosk Network', '🏪', 'Tiny shops everywhere.', { presence: 5 }, 60),
    P('acquire', 'Buy a Local Shop', '🏚️', 'Their customers become yours.', { presence: 10, income: 0.02 }, 120, 0.04),
    P('ad-district', 'District Ad Takeover', '📺', 'Every screen shows you.', { presence: 6, traffic: 0.04 }, 60),
    P('warehouse', 'Local Warehouse', '🏭', 'Faster deliveries, happier customers.', { presence: 4, speed: 0.04 }, 120),
    P('community', 'Sponsor Local Team', '⚽', 'The neighbourhood loves you.', { presence: 5, reputation: 2 }, 90),
    P('blitz', 'Market Blitz', '💥', 'Everything at once.', { presence: 12, traffic: 0.04 }, 45, 0.06),
  ],
  shady: [
    P('offshore', 'Offshore Account', '🏝️', 'Hide some income on a sunny island.', { income: 0.08, undeclared: 0.6, auditRisk: 10 }, 60, 0.06),
    P('cookbooks', 'Creative Accounting', '📒', 'Numbers are more of a suggestion.', { income: 0.06, undeclared: 0.8, auditRisk: 12 }, 45, 0.08),
    P('fakereviews', 'Fake Reviews', '⭐', 'Five stars from "Definitely A Real Person".', { traffic: 0.1, auditRisk: 4 }, 45, 0.12),
    P('poach', 'Poach Rival Staff', '🎣', 'Lure their best workers away.', { speed: 0.08, quality: 2, legal: -2 }, 60, 0.08),
    P('cashonly', 'Cash-Only Weekend', '💵', '"The card machine is broken."', { income: 0.07, undeclared: 1, auditRisk: 8 }, 30, 0.05),
    P('spy', 'Corporate Spy', '🕵️', 'Peek at the competition\'s plans.', { research: 0.15, legal: -3 }, 45, 0.1),
    P('pricefix', 'Price-Fixing Chat', '🤫', 'Everyone agrees to charge more.', { income: 0.1, auditRisk: 8, legal: -4 }, 45, 0.12),
    P('shellco', 'Shell Company', '🐚', 'A company inside a company inside a box.', { income: 0.05, undeclared: 1, auditRisk: 15 }, 90, 0.06),
    P('cornercut', 'Cut Corners', '📐', 'Nobody checks the back of the cupboard.', { speed: 0.12, quality: -5 }, 45, 0.08),
    P('bribe', 'Envelope for the Inspector', '✉️', 'A "gift". Totally normal.', { auditRisk: -15, legal: -5 }, 60, 0.15),
  ],
};

export const STRATEGY_TIERS = [
  { tier: 1, name: 'Scrappy', level: 1, cost: 1, power: 1 },
  { tier: 2, name: 'Solid', level: 5, cost: 3, power: 1.6 },
  { tier: 3, name: 'Bold', level: 12, cost: 8, power: 2.2 },
  { tier: 4, name: 'Mega', level: 22, cost: 20, power: 2.8 },
  { tier: 5, name: 'Legendary', level: 35, cost: 50, power: 3.4 },
] as const;

export interface StrategyAction {
  id: string;
  category: StrategyCategory;
  tier: number;
  name: string;
  emoji: string;
  blurb: string;
  fx: StrategyFx;
  minutes: number;
  cooldownMinutes: number;
  cost: number;
  influenceCost: number;
  level: number;
  risk: number;
  shady: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function scaleFx(fx: StrategyFx, power: number): StrategyFx {
  const out: StrategyFx = {};
  for (const [k, v] of Object.entries(fx) as Array<[keyof StrategyFx, number]>) {
    if (k === 'undeclared') out[k] = v; // a share, not a size
    else if (k === 'mood' || k === 'quality' || k === 'influence' || k === 'presence' || k === 'legal' || k === 'reputation' || k === 'auditRisk') out[k] = Math.round(v * power);
    else out[k] = r3(v * power);
  }
  return out;
}

function build(): StrategyAction[] {
  const out: StrategyAction[] = [];
  for (const [category, plays] of Object.entries(PLAYS) as Array<[StrategyCategory, BasePlay[]]>) {
    const cat = STRATEGY_CATEGORIES[category];
    for (const p of plays) {
      for (const t of STRATEGY_TIERS) {
        const minutes = Math.round(p.minutes * (1 + 0.25 * (t.tier - 1)));
        out.push({
          id: `${p.key}-${t.tier}`,
          category,
          tier: t.tier,
          name: `${t.name} ${p.name}`,
          emoji: p.emoji,
          blurb: p.blurb,
          fx: scaleFx(p.fx, t.power),
          minutes,
          cooldownMinutes: minutes * 2,
          cost: cat.baseCost * t.cost,
          influenceCost: category === 'expansion' ? t.tier - 1 : 0,
          level: t.level,
          risk: r3(Math.min(0.5, (p.risk ?? 0) * (1 + 0.2 * (t.tier - 1)))),
          shady: category === 'shady',
        });
      }
    }
  }
  return out;
}

/** All 500 strategic actions. */
export const STRATEGY_ACTIONS: StrategyAction[] = build();
const BY_ID = new Map(STRATEGY_ACTIONS.map((a) => [a.id, a]));
export const findStrategyAction = (id: string) => BY_ID.get(id);

// ------------------------------------------------------------ policies
export const POLICIES = {
  pricing: {
    label: 'Pricing',
    emoji: '🏷️',
    options: {
      discount: { label: 'Discount', blurb: '+10% customers, -5% income per sale', fx: { traffic: 0.1, income: -0.05 } },
      balanced: { label: 'Balanced', blurb: 'No change', fx: {} },
      premium: { label: 'Premium', blurb: '+8% income, -8% customers', fx: { income: 0.08, traffic: -0.08 } },
    },
  },
  labor: {
    label: 'Labour',
    emoji: '👷',
    options: {
      lean: { label: 'Lean', blurb: '-8% wages, -6 mood', fx: { wages: -0.08, mood: -6 } },
      fair: { label: 'Fair', blurb: 'No change', fx: {} },
      generous: { label: 'Generous', blurb: '+10% wages, +8 mood, +3% speed', fx: { wages: 0.1, mood: 8, speed: 0.03 } },
    },
  },
  risk: {
    label: 'Risk appetite',
    emoji: '🎲',
    options: {
      careful: { label: 'Careful', blurb: 'Actions 10% weaker, half the backfire risk', fx: {} },
      steady: { label: 'Steady', blurb: 'No change', fx: {} },
      bold: { label: 'Bold', blurb: 'Actions 20% stronger, 50% more backfire risk', fx: {} },
    },
  },
} as const;
export type PolicyKey = keyof typeof POLICIES;
export type Policies = { pricing: keyof typeof POLICIES.pricing.options; labor: keyof typeof POLICIES.labor.options; risk: keyof typeof POLICIES.risk.options };
export const DEFAULT_POLICIES: Policies = { pricing: 'balanced', labor: 'fair', risk: 'steady' };

// ------------------------------------------------------------ districts
export const DISTRICTS = [
  { id: 'downtown', name: 'Downtown', emoji: '🏙️' },
  { id: 'harbor', name: 'Harbour', emoji: '⚓' },
  { id: 'techpark', name: 'Tech Park', emoji: '💾' },
  { id: 'oldtown', name: 'Old Town', emoji: '🏰' },
  { id: 'suburbs', name: 'Suburbs', emoji: '🏡' },
  { id: 'farmland', name: 'Farmland', emoji: '🌾' },
  { id: 'uni', name: 'University Hill', emoji: '🎓' },
  { id: 'airport', name: 'Airport', emoji: '✈️' },
] as const;
export type DistrictId = (typeof DISTRICTS)[number]['id'];

// ------------------------------------------------------------ laws
export const LAW_TEMPLATES = [
  { key: 'relief', title: 'Small Business Relief Act', emoji: '🩹', blurb: 'Every company earns +5% for 3 days.', kind: 'income', value: 1.05, hours: 72 },
  { key: 'spending', title: 'Consumer Spending Bonanza', emoji: '🛍️', blurb: '+8% customers everywhere for 2 days.', kind: 'traffic', value: 1.08, hours: 48 },
  { key: 'workers', title: 'Happy Workers Act', emoji: '😊', blurb: '+5 mood for every worker for 3 days.', kind: 'mood', value: 5, hours: 72 },
  { key: 'innovation', title: 'Innovation Grant Act', emoji: '🔬', blurb: '+15% research speed for 3 days.', kind: 'research', value: 1.15, hours: 72 },
  { key: 'productivity', title: 'Productivity Push', emoji: '⚡', blurb: '+6% production speed for 2 days.', kind: 'speed', value: 1.06, hours: 48 },
  { key: 'austerity', title: 'Austerity Measures', emoji: '🪙', blurb: '-4% income for 2 days. Nobody likes it.', kind: 'income', value: 0.96, hours: 48 },
  { key: 'crackdown', title: 'Audit Crackdown', emoji: '🔦', blurb: 'Raises every company\'s audit risk by 15.', kind: 'auditRisk', value: 15, hours: 0 },
  { key: 'amnesty', title: 'Tax Amnesty', emoji: '🕊️', blurb: 'Halves everyone\'s audit risk. Fresh start!', kind: 'amnesty', value: 0.5, hours: 0 },
] as const;
export type LawKey = (typeof LAW_TEMPLATES)[number]['key'];

// ------------------------------------------------------------ court
export const CASE_KINDS = {
  breach: { label: 'Breach of contract', emoji: '📄' },
  unfair: { label: 'Unfair competition', emoji: '🥊' },
  fraud: { label: 'Fraud', emoji: '🎭' },
  defamation: { label: 'Defamation', emoji: '🗯️' },
  ip: { label: 'IP theft', emoji: '💡' },
  antitrust: { label: 'Antitrust', emoji: '🧱' },
  tax: { label: 'Tax evasion', emoji: '🧾' },
  labor: { label: 'Labour violations', emoji: '👷' },
} as const;
export type CaseKind = keyof typeof CASE_KINDS;

export const EVIDENCE_KINDS = {
  document: { label: 'Document', emoji: '📄', cost: 0, weight: 1 },
  witness: { label: 'Witness', emoji: '🙋', cost: 200, weight: 2 },
  expert: { label: 'Expert report', emoji: '🧑‍🔬', cost: 800, weight: 4 },
  ledger: { label: 'Ledger records', emoji: '📒', cost: 400, weight: 3 },
} as const;
export type EvidenceKind = keyof typeof EVIDENCE_KINDS;

export const UNION_OFFICES = {
  president: { label: 'President', emoji: '👑' },
  vp: { label: 'Vice President', emoji: '🎖️' },
  treasurer: { label: 'Treasurer', emoji: '💼' },
} as const;
export type UnionOffice = keyof typeof UNION_OFFICES;

export const UNION_MOVES = {
  bargain: { label: 'Collective Bargaining', emoji: '🤝', blurb: 'Every member pays 6% less in wages for 6 hours.', cost: 3000, office: 'president' },
  rally: { label: 'Solidarity Rally', emoji: '✊', blurb: '+6 worker mood at every member for 4 hours.', cost: 1500, office: 'vp' },
  coop: { label: 'Co-op Marketing', emoji: '📣', blurb: '+5% customers for every member for 4 hours.', cost: 2500, office: 'president' },
  strike: { label: 'Strike Against a Company', emoji: '🪧', blurb: 'Picket a non-member: -12% customers for them for 3 hours.', cost: 4000, office: 'president' },
  grant: { label: 'Member Grant', emoji: '🎁', blurb: 'Pay Bits from the union treasury to one member.', cost: 0, office: 'treasurer' },
  lobby: { label: 'Union Lobbying', emoji: '🏛️', blurb: 'Turn treasury Bits into union influence (100 BT = 1).', cost: 0, office: 'treasurer' },
} as const;
export type UnionMove = keyof typeof UNION_MOVES;
