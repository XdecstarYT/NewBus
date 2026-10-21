/** Digital Workforce Live: politics, justice and account rules shared by API and web. */

export type Role = 'OWNER' | 'ADMIN' | 'STAFF';

/** Features the court or the Owner can suspend for a company. */
export const FEATURES = {
  work: { label: 'Working shifts', emoji: '⚒️' },
  market: { label: 'Market', emoji: '📈' },
  shop: { label: 'Shop & POS', emoji: '🛒' },
  transfers: { label: 'Transfers', emoji: '💸' },
  build: { label: 'Building', emoji: '🏗️' },
} as const;
export type Feature = keyof typeof FEATURES;

export const UNION_OFFICES = {
  president: { label: 'President', emoji: '👑' },
  vp: { label: 'Vice President', emoji: '🎖️' },
  treasurer: { label: 'Treasurer', emoji: '💼' },
} as const;
export type UnionOffice = keyof typeof UNION_OFFICES;

export const CASE_KINDS = {
  breach: { label: 'Breach of contract', emoji: '📄' },
  fraud: { label: 'Fraud', emoji: '🎭' },
  scam: { label: 'Scam / unpaid deal', emoji: '🪤' },
  defamation: { label: 'Defamation', emoji: '🗯️' },
  unfair: { label: 'Unfair competition', emoji: '🥊' },
  tax: { label: 'Tax evasion', emoji: '🧾' },
} as const;
export type CaseKind = keyof typeof CASE_KINDS;

export const EVIDENCE_KINDS = {
  document: { label: 'Document', emoji: '📄', cost: 0, weight: 1 },
  witness: { label: 'Witness', emoji: '🙋', cost: 50, weight: 2 },
  ledger: { label: 'Ledger records', emoji: '📒', cost: 100, weight: 3 },
  expert: { label: 'Expert report', emoji: '🧑‍🔬', cost: 250, weight: 4 },
} as const;
export type EvidenceKind = keyof typeof EVIDENCE_KINDS;

export const LAW_KINDS = {
  tax: { label: 'Set the sales tax', emoji: '🧾', unit: '%', blurb: 'Sales tax on every market, shop and POS sale becomes this %.' },
  stimulus: { label: 'Stimulus payment', emoji: '💸', unit: 'BT each', blurb: 'The Treasury pays this much to every company.' },
  energy: { label: 'Energy boost', emoji: '⚡', unit: 'Energy/hour for 24 h', blurb: 'Everyone regenerates this much extra Energy per hour for a day.' },
} as const;
export type LawKind = keyof typeof LAW_KINDS;

export const DEFAULT_SETTINGS = {
  salesTaxPct: 5,
  startingGrant: 2000,
  unionCreateCost: 500,
  /** Union members pay half tax when trading with each other. */
  unionTaxDiscount: true,
  courtFilingPct: 5,
  appealHours: 24,
  hearingMinutes: 60,
  nominateMinutes: 30,
  voteMinutes: 60,
  unionTermDays: 3,
  lawVoteHours: 24,
  /** Office work and AI customers are paid by the Treasury; when it runs dry, new Bits top it up. */
  mintForWork: true,
  /** Office-work jobs posted automatically by AI clients each day. */
  autoJobsPerDay: 6,
  /** How many AI customer orders are open at once. */
  customersOpen: 6,
  /** AI customers pay this % of the going market price. */
  customerPayPct: 130,
  /** Bits for each finished daily quest. */
  questReward: 40,
  /** Use the AI (key in AIK) for grading, customers, clients and haggling. */
  aiEnabled: true,
};
export type Settings = typeof DEFAULT_SETTINGS;
